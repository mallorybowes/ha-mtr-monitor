"""Sensor platform for MTR Network Monitor.

Creates sensors for:
  - Each hop: RTT (avg, min, max, last), loss %, jitter, sent/received counts
  - Destination hop also gets a dedicated "destination" sensor
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DOMAIN,
    DATA_COORDINATOR,
    ATTR_HOP_NUMBER,
    ATTR_HOP_IP,
    ATTR_HOP_HOSTNAME,
    ATTR_LOSS_PCT,
    ATTR_SENT,
    ATTR_RECEIVED,
    ATTR_LAST_RTT,
    ATTR_AVG_RTT,
    ATTR_MIN_RTT,
    ATTR_MAX_RTT,
    ATTR_JITTER,
    ATTR_PROTOCOL,
    ATTR_PORT,
    ATTR_HOP_STATUS,
    STATUS_OK,
    STATUS_DEGRADED,
    STATUS_TIMEOUT,
    STATUS_NO_RESPONSE,
    LOSS_THRESHOLD_DEGRADED,
    LOSS_THRESHOLD_DOWN,
)
from .coordinator import MTRCoordinator
from .mtr_engine import HopResult

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors from config entry."""
    coordinator: MTRCoordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]
    config = hass.data[DOMAIN][entry.entry_id]["config"]

    host = config["host"]
    protocol = config["protocol"]
    port = config.get("port")
    entry_id = entry.entry_id

    device_info = DeviceInfo(
        identifiers={(DOMAIN, entry_id)},
        name=entry.title,
        manufacturer="MTR Network Monitor",
        model=f"{protocol.upper()} → {host}",
    )

    entities: list[SensorEntity] = []

    # We create per-hop sensors dynamically after first data fetch
    if coordinator.data:
        for hop in coordinator.data:
            entities.append(
                MTRHopRTTSensor(coordinator, entry_id, hop.hop, host, protocol, port, device_info)
            )
            entities.append(
                MTRHopLossSensor(coordinator, entry_id, hop.hop, host, protocol, port, device_info)
            )

    async_add_entities(entities, True)


def _hop_status(hop: HopResult) -> str:
    if hop.sent == 0:
        return STATUS_NO_RESPONSE
    if hop.loss_pct >= LOSS_THRESHOLD_DOWN:
        return STATUS_TIMEOUT
    if hop.loss_pct >= LOSS_THRESHOLD_DEGRADED:
        return STATUS_DEGRADED
    return STATUS_OK


class MTRHopRTTSensor(CoordinatorEntity[MTRCoordinator], SensorEntity):
    """Average RTT sensor for a specific hop."""

    _attr_native_unit_of_measurement = "ms"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(
        self,
        coordinator: MTRCoordinator,
        entry_id: str,
        hop_num: int,
        host: str,
        protocol: str,
        port: int | None,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self._hop_num = hop_num
        self._host = host
        self._protocol = protocol
        self._port = port
        self._attr_unique_id = f"{entry_id}_hop{hop_num}_rtt"
        self._attr_name = f"{host} Hop {hop_num} RTT"
        self._attr_device_info = device_info

    def _get_hop(self) -> HopResult | None:
        if not self.coordinator.data:
            return None
        for h in self.coordinator.data:
            if h.hop == self._hop_num:
                return h
        return None

    @property
    def native_value(self) -> float | None:
        hop = self._get_hop()
        return hop.avg_rtt if hop else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        hop = self._get_hop()
        if not hop:
            return {}
        return {
            ATTR_HOP_NUMBER: hop.hop,
            ATTR_HOP_IP: hop.ip,
            ATTR_HOP_HOSTNAME: hop.hostname,
            ATTR_LAST_RTT: hop.last_rtt,
            ATTR_AVG_RTT: hop.avg_rtt,
            ATTR_MIN_RTT: hop.min_rtt,
            ATTR_MAX_RTT: hop.max_rtt,
            ATTR_JITTER: hop.jitter,
            ATTR_SENT: hop.sent,
            ATTR_RECEIVED: hop.received,
            ATTR_LOSS_PCT: hop.loss_pct,
            ATTR_PROTOCOL: self._protocol,
            ATTR_PORT: self._port,
            ATTR_HOP_STATUS: _hop_status(hop),
        }


class MTRHopLossSensor(CoordinatorEntity[MTRCoordinator], SensorEntity):
    """Packet loss % sensor for a specific hop."""

    _attr_native_unit_of_measurement = "%"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1

    def __init__(
        self,
        coordinator: MTRCoordinator,
        entry_id: str,
        hop_num: int,
        host: str,
        protocol: str,
        port: int | None,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self._hop_num = hop_num
        self._host = host
        self._protocol = protocol
        self._port = port
        self._attr_unique_id = f"{entry_id}_hop{hop_num}_loss"
        self._attr_name = f"{host} Hop {hop_num} Loss"
        self._attr_device_info = device_info

    def _get_hop(self) -> HopResult | None:
        if not self.coordinator.data:
            return None
        for h in self.coordinator.data:
            if h.hop == self._hop_num:
                return h
        return None

    @property
    def native_value(self) -> float | None:
        hop = self._get_hop()
        return hop.loss_pct if hop else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        hop = self._get_hop()
        if not hop:
            return {}
        return {
            ATTR_HOP_NUMBER: hop.hop,
            ATTR_HOP_IP: hop.ip,
            ATTR_HOP_HOSTNAME: hop.hostname,
            ATTR_SENT: hop.sent,
            ATTR_RECEIVED: hop.received,
            ATTR_HOP_STATUS: _hop_status(hop),
        }
