"""Binary sensor platform for MTR Network Monitor.

Provides:
  - Destination reachability (on = reachable)
  - Per-hop health (on = healthy)
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
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
    ATTR_AVG_RTT,
    ATTR_JITTER,
    ATTR_PROTOCOL,
    ATTR_PORT,
    ATTR_HOP_STATUS,
    STATUS_OK,
    STATUS_DEGRADED,
    STATUS_TIMEOUT,
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

    entities: list[BinarySensorEntity] = []

    # Always create a destination reachability sensor
    entities.append(
        MTRDestinationSensor(coordinator, entry_id, host, protocol, port, device_info)
    )

    # Per-hop health sensors
    if coordinator.data:
        for hop in coordinator.data:
            entities.append(
                MTRHopHealthSensor(
                    coordinator, entry_id, hop.hop, host, protocol, port, device_info
                )
            )

    async_add_entities(entities, True)


class MTRDestinationSensor(CoordinatorEntity[MTRCoordinator], BinarySensorEntity):
    """Binary sensor: is the destination reachable?"""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    def __init__(
        self,
        coordinator: MTRCoordinator,
        entry_id: str,
        host: str,
        protocol: str,
        port: int | None,
        device_info: DeviceInfo,
    ) -> None:
        super().__init__(coordinator)
        self._host = host
        self._protocol = protocol
        self._port = port
        self._attr_unique_id = f"{entry_id}_destination"
        self._attr_name = f"{host} Reachable"
        self._attr_device_info = device_info

    def _dest_hop(self) -> HopResult | None:
        """Return the last hop (destination)."""
        if not self.coordinator.data:
            return None
        return self.coordinator.data[-1]

    @property
    def is_on(self) -> bool | None:
        hop = self._dest_hop()
        if hop is None:
            return None
        return hop.loss_pct < LOSS_THRESHOLD_DOWN

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        hop = self._dest_hop()
        if not hop:
            return {}
        status = STATUS_OK
        if hop.loss_pct >= LOSS_THRESHOLD_DOWN:
            status = STATUS_TIMEOUT
        return {
            ATTR_HOP_IP: hop.ip,
            ATTR_HOP_HOSTNAME: hop.hostname or self._host,
            ATTR_LOSS_PCT: hop.loss_pct,
            ATTR_AVG_RTT: hop.avg_rtt,
            ATTR_JITTER: hop.jitter,
            ATTR_PROTOCOL: self._protocol,
            ATTR_PORT: self._port,
            ATTR_HOP_STATUS: status,
            "total_hops": len(self.coordinator.data) if self.coordinator.data else None,
        }


class MTRHopHealthSensor(CoordinatorEntity[MTRCoordinator], BinarySensorEntity):
    """Binary sensor: is this hop healthy (< degraded threshold)?"""

    _attr_device_class = BinarySensorDeviceClass.PROBLEM  # on = problem

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
        self._attr_unique_id = f"{entry_id}_hop{hop_num}_health"
        self._attr_name = f"{host} Hop {hop_num} Problem"
        self._attr_device_info = device_info

    def _get_hop(self) -> HopResult | None:
        if not self.coordinator.data:
            return None
        for h in self.coordinator.data:
            if h.hop == self._hop_num:
                return h
        return None

    @property
    def is_on(self) -> bool | None:
        """Return True if there is a problem (loss >= degraded threshold)."""
        hop = self._get_hop()
        if hop is None:
            return None
        from .const import LOSS_THRESHOLD_DEGRADED
        return hop.loss_pct >= LOSS_THRESHOLD_DEGRADED

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        hop = self._get_hop()
        if not hop:
            return {}
        status = STATUS_OK
        from .const import LOSS_THRESHOLD_DEGRADED
        if hop.loss_pct >= LOSS_THRESHOLD_DOWN:
            status = STATUS_TIMEOUT
        elif hop.loss_pct >= LOSS_THRESHOLD_DEGRADED:
            status = STATUS_DEGRADED
        return {
            ATTR_HOP_NUMBER: hop.hop,
            ATTR_HOP_IP: hop.ip,
            ATTR_HOP_HOSTNAME: hop.hostname,
            ATTR_LOSS_PCT: hop.loss_pct,
            ATTR_AVG_RTT: hop.avg_rtt,
            ATTR_HOP_STATUS: status,
        }
