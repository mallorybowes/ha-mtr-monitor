"""Data coordinator for MTR Network Monitor."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    DOMAIN,
    CONF_HOST,
    CONF_PROTOCOL,
    CONF_PORT,
    CONF_MAX_HOPS,
    CONF_COUNT,
    CONF_TIMEOUT,
    CONF_PACKET_INTERVAL,
    DEFAULT_PORT,
    DEFAULT_PACKET_INTERVAL,
)
from .mtr_engine import async_mtr_sweep, HopResult

_LOGGER = logging.getLogger(__name__)


class MTRCoordinator(DataUpdateCoordinator[list[HopResult]]):
    """Coordinator that runs MTR sweeps on a schedule."""

    def __init__(self, hass: HomeAssistant, config: dict[str, Any], interval: int) -> None:
        self._host = config[CONF_HOST]
        self._protocol = config[CONF_PROTOCOL]
        self._port = config.get(CONF_PORT, DEFAULT_PORT)
        self._max_hops = config[CONF_MAX_HOPS]
        self._count = config[CONF_COUNT]
        self._timeout = config[CONF_TIMEOUT]
        self._packet_interval = config.get(CONF_PACKET_INTERVAL, DEFAULT_PACKET_INTERVAL)

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self._host}",
            update_interval=timedelta(seconds=interval),
        )

    async def _async_update_data(self) -> list[HopResult]:
        try:
            hops = await async_mtr_sweep(
                host=self._host,
                protocol=self._protocol,
                port=self._port,
                max_hops=self._max_hops,
                count=self._count,
                timeout=self._timeout,
                packet_interval=self._packet_interval,
            )
            if not hops:
                raise UpdateFailed(f"MTR sweep returned no data for {self._host}")
            return hops
        except Exception as exc:
            raise UpdateFailed(f"MTR sweep failed: {exc}") from exc
