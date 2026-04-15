"""
MTR-style network probing engine.

Supports ICMP echo, TCP SYN, and UDP probes using raw sockets (ICMP)
and standard sockets (TCP/UDP).  Each sweep traces the path to the
destination by sending probes with incrementing TTL values and
collecting ICMP Time-Exceeded replies.

Requires the integration to run as root (or with CAP_NET_RAW) for
ICMP and UDP raw-socket probes.  TCP probes use a high-level connect()
and do not need elevated privileges.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import struct
import time
import os
import errno
from dataclasses import dataclass, field
from typing import Optional

_LOGGER = logging.getLogger(__name__)

ICMP_ECHO_REQUEST = 8
ICMP_ECHO_REPLY = 0
ICMP_TIME_EXCEEDED = 11
ICMP_PORT_UNREACHABLE = 3


@dataclass
class HopResult:
    """Result for a single TTL hop."""

    hop: int
    ip: Optional[str] = None
    hostname: Optional[str] = None
    rtts: list[float] = field(default_factory=list)
    sent: int = 0
    received: int = 0

    @property
    def loss_pct(self) -> float:
        if self.sent == 0:
            return 0.0
        return round((self.sent - self.received) / self.sent * 100, 1)

    @property
    def avg_rtt(self) -> Optional[float]:
        return round(sum(self.rtts) / len(self.rtts), 2) if self.rtts else None

    @property
    def min_rtt(self) -> Optional[float]:
        return round(min(self.rtts), 2) if self.rtts else None

    @property
    def max_rtt(self) -> Optional[float]:
        return round(max(self.rtts), 2) if self.rtts else None

    @property
    def last_rtt(self) -> Optional[float]:
        return round(self.rtts[-1], 2) if self.rtts else None

    @property
    def jitter(self) -> Optional[float]:
        if len(self.rtts) < 2:
            return None
        diffs = [abs(self.rtts[i] - self.rtts[i - 1]) for i in range(1, len(self.rtts))]
        return round(sum(diffs) / len(diffs), 2)


def _checksum(data: bytes) -> int:
    """Standard Internet checksum."""
    if len(data) % 2:
        data += b"\x00"
    s = 0
    for i in range(0, len(data), 2):
        w = (data[i] << 8) + data[i + 1]
        s += w
    s = (s >> 16) + (s & 0xFFFF)
    s += s >> 16
    return ~s & 0xFFFF


def _build_icmp_packet(seq: int, payload_size: int = 32) -> bytes:
    """Build an ICMP Echo Request packet."""
    pid = os.getpid() & 0xFFFF
    header = struct.pack("!BBHHH", ICMP_ECHO_REQUEST, 0, 0, pid, seq)
    data = bytes(range(payload_size % 256)) * (payload_size // 256 + 1)
    data = data[:payload_size]
    chk = _checksum(header + data)
    header = struct.pack("!BBHHH", ICMP_ECHO_REQUEST, 0, chk, pid, seq)
    return header + data


def _resolve_host(host: str) -> Optional[str]:
    try:
        return socket.gethostbyname(host)
    except socket.gaierror:
        return None


def _reverse_dns(ip: str) -> Optional[str]:
    try:
        result = socket.gethostbyaddr(ip)
        return result[0]
    except (socket.herror, socket.gaierror):
        return None


# ---------------------------------------------------------------------------
# ICMP Probe (raw socket, requires root / CAP_NET_RAW)
# ---------------------------------------------------------------------------

def _icmp_probe(dest_ip: str, ttl: int, seq: int, timeout: float) -> tuple[Optional[str], Optional[float]]:
    """
    Send one ICMP echo with the given TTL.
    Returns (reply_ip, rtt_ms) or (None, None) on timeout.
    """
    try:
        recv_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        recv_sock.settimeout(timeout)
        recv_sock.bind(("", 0))

        send_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        send_sock.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, ttl)

        packet = _build_icmp_packet(seq)
        send_time = time.perf_counter()
        send_sock.sendto(packet, (dest_ip, 0))

        while True:
            try:
                raw, addr = recv_sock.recvfrom(512)
                recv_time = time.perf_counter()
                # Parse outer IP header (20 bytes) then ICMP
                icmp_type = raw[20]
                if icmp_type == ICMP_TIME_EXCEEDED:
                    return addr[0], (recv_time - send_time) * 1000
                elif icmp_type == ICMP_ECHO_REPLY:
                    # Verify it's our packet
                    inner_seq = struct.unpack("!H", raw[26:28])[0]
                    if inner_seq == seq:
                        return addr[0], (recv_time - send_time) * 1000
            except socket.timeout:
                return None, None
    except PermissionError:
        _LOGGER.error("ICMP probe requires root / CAP_NET_RAW privileges")
        return None, None
    except OSError as exc:
        _LOGGER.debug("ICMP probe OS error: %s", exc)
        return None, None
    finally:
        try:
            recv_sock.close()
            send_sock.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# TCP Probe  (no root required)
# ---------------------------------------------------------------------------

def _tcp_probe(dest_ip: str, port: int, ttl: int, timeout: float) -> tuple[Optional[str], Optional[float]]:
    """
    Attempt a TCP connect with the given TTL.
    On intermediate hops we expect ICMP Time-Exceeded via a raw recv socket;
    at the destination we expect connection success or reset.
    """
    recv_sock = None
    send_sock = None
    try:
        recv_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        recv_sock.settimeout(timeout)

        send_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        send_sock.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, ttl)
        send_sock.settimeout(timeout)

        send_time = time.perf_counter()
        try:
            send_sock.connect((dest_ip, port))
            recv_time = time.perf_counter()
            return dest_ip, (recv_time - send_time) * 1000
        except ConnectionRefusedError:
            recv_time = time.perf_counter()
            return dest_ip, (recv_time - send_time) * 1000
        except OSError:
            pass

        # Try reading ICMP Time-Exceeded
        try:
            raw, addr = recv_sock.recvfrom(512)
            recv_time = time.perf_counter()
            icmp_type = raw[20]
            if icmp_type in (ICMP_TIME_EXCEEDED, ICMP_PORT_UNREACHABLE):
                return addr[0], (recv_time - send_time) * 1000
        except socket.timeout:
            pass

        return None, None
    except PermissionError:
        _LOGGER.debug("TCP raw recv socket requires privileges; falling back to connect-only")
        # Fallback: plain connect
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, ttl)
            s.settimeout(timeout)
            t0 = time.perf_counter()
            try:
                s.connect((dest_ip, port))
            except (ConnectionRefusedError, OSError):
                pass
            return dest_ip, (time.perf_counter() - t0) * 1000
        except OSError:
            return None, None
        finally:
            try:
                s.close()
            except Exception:
                pass
    except OSError as exc:
        _LOGGER.debug("TCP probe error: %s", exc)
        return None, None
    finally:
        for s in (recv_sock, send_sock):
            if s:
                try:
                    s.close()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# UDP Probe  (root / CAP_NET_RAW for raw recv)
# ---------------------------------------------------------------------------

def _udp_probe(dest_ip: str, port: int, ttl: int, seq: int, timeout: float) -> tuple[Optional[str], Optional[float]]:
    """
    Send a UDP packet with the given TTL and listen for ICMP reply.
    """
    recv_sock = None
    send_sock = None
    try:
        recv_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
        recv_sock.settimeout(timeout)

        send_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        send_sock.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, ttl)
        send_sock.settimeout(timeout)

        payload = struct.pack("!H", seq) + b"\x00" * 20
        send_time = time.perf_counter()
        send_sock.sendto(payload, (dest_ip, port))

        try:
            raw, addr = recv_sock.recvfrom(512)
            recv_time = time.perf_counter()
            icmp_type = raw[20]
            if icmp_type in (ICMP_TIME_EXCEEDED, ICMP_PORT_UNREACHABLE):
                return addr[0], (recv_time - send_time) * 1000
        except socket.timeout:
            return None, None

        return None, None
    except PermissionError:
        _LOGGER.error("UDP probe requires root / CAP_NET_RAW privileges")
        return None, None
    except OSError as exc:
        _LOGGER.debug("UDP probe OS error: %s", exc)
        return None, None
    finally:
        for s in (recv_sock, send_sock):
            if s:
                try:
                    s.close()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# High-level async MTR sweep
# ---------------------------------------------------------------------------

async def async_mtr_sweep(
    host: str,
    protocol: str,
    port: int,
    max_hops: int,
    count: int,
    timeout: float,
    packet_interval: float = 0.0,
) -> list[HopResult]:
    """
    Perform a full MTR-style sweep asynchronously.
    Returns a list of HopResult, one per hop up to max_hops or destination.

    packet_interval: seconds to wait between consecutive probe packets.
    Set to e.g. 1.0 to send at most one packet per second, 5.0 for one
    packet every five seconds, etc.  0.0 (default) means no imposed delay.
    """
    loop = asyncio.get_event_loop()

    dest_ip = await loop.run_in_executor(None, _resolve_host, host)
    if dest_ip is None:
        _LOGGER.error("Cannot resolve host: %s", host)
        return []

    results: list[HopResult] = []
    seq_counter = 0
    first_probe = True

    for ttl in range(1, max_hops + 1):
        hop = HopResult(hop=ttl)

        for _ in range(count):
            seq_counter += 1

            # Rate-limit: pause before every probe except the very first one
            if packet_interval > 0.0 and not first_probe:
                await asyncio.sleep(packet_interval)
            first_probe = False

            if protocol == "icmp":
                reply_ip, rtt = await loop.run_in_executor(
                    None, _icmp_probe, dest_ip, ttl, seq_counter, timeout
                )
            elif protocol == "tcp":
                reply_ip, rtt = await loop.run_in_executor(
                    None, _tcp_probe, dest_ip, port, ttl, timeout
                )
            else:  # udp
                reply_ip, rtt = await loop.run_in_executor(
                    None, _udp_probe, dest_ip, port, ttl, seq_counter, timeout
                )

            hop.sent += 1
            if reply_ip and rtt is not None:
                hop.received += 1
                hop.rtts.append(rtt)
                if hop.ip is None:
                    hop.ip = reply_ip

        # Reverse-DNS the hop IP (non-blocking)
        if hop.ip and hop.ip != dest_ip:
            hop.hostname = await loop.run_in_executor(None, _reverse_dns, hop.ip)

        results.append(hop)

        # Stop if we reached the destination
        if hop.ip == dest_ip:
            break

    # Ensure destination hop always has hostname
    if results and results[-1].ip == dest_ip:
        if not results[-1].hostname:
            results[-1].hostname = host if host != dest_ip else None

    return results
