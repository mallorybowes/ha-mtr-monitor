"""Constants for the MTR Network Monitor integration."""

DOMAIN = "mtr_monitor"

# Configuration keys
CONF_HOST = "host"
CONF_PROTOCOL = "protocol"
CONF_PORT = "port"
CONF_MAX_HOPS = "max_hops"
CONF_COUNT = "count"
CONF_TIMEOUT = "timeout"
CONF_PACKET_INTERVAL = "packet_interval"

# Protocol options
PROTOCOL_ICMP = "icmp"
PROTOCOL_TCP = "tcp"
PROTOCOL_UDP = "udp"

PROTOCOLS = [PROTOCOL_ICMP, PROTOCOL_TCP, PROTOCOL_UDP]

# Defaults
DEFAULT_INTERVAL = 60          # seconds between full MTR sweeps
DEFAULT_MAX_HOPS = 30
DEFAULT_COUNT = 3              # probes per hop per sweep
DEFAULT_TIMEOUT = 2            # seconds per probe
DEFAULT_PORT = 80              # used for TCP/UDP
DEFAULT_PACKET_INTERVAL = 0.0  # seconds between individual probe packets (0 = no delay)

# Internal data keys
DATA_COORDINATOR = "coordinator"
DATA_CONFIG = "config"

# Sensor attribute keys
ATTR_HOP_NUMBER = "hop_number"
ATTR_HOP_IP = "hop_ip"
ATTR_HOP_HOSTNAME = "hop_hostname"
ATTR_LOSS_PCT = "loss_pct"
ATTR_SENT = "sent"
ATTR_RECEIVED = "received"
ATTR_LAST_RTT = "last_rtt_ms"
ATTR_AVG_RTT = "avg_rtt_ms"
ATTR_MIN_RTT = "min_rtt_ms"
ATTR_MAX_RTT = "max_rtt_ms"
ATTR_JITTER = "jitter_ms"
ATTR_PROTOCOL = "protocol"
ATTR_PORT = "port"
ATTR_HOP_STATUS = "status"

# Hop status values
STATUS_OK = "ok"
STATUS_DEGRADED = "degraded"
STATUS_TIMEOUT = "timeout"
STATUS_NO_RESPONSE = "no_response"
STATUS_UNKNOWN = "unknown"

# Loss thresholds
LOSS_THRESHOLD_DEGRADED = 10   # % loss → degraded
LOSS_THRESHOLD_DOWN = 100      # % loss → down/timeout
