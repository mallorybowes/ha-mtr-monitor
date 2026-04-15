"""Config flow for MTR Network Monitor."""

from __future__ import annotations

import socket
import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
import homeassistant.helpers.config_validation as cv

from .const import (
    DOMAIN,
    CONF_HOST,
    CONF_PROTOCOL,
    CONF_PORT,
    CONF_MAX_HOPS,
    CONF_COUNT,
    CONF_TIMEOUT,
    CONF_PACKET_INTERVAL,
    PROTOCOLS,
    PROTOCOL_ICMP,
    DEFAULT_INTERVAL,
    DEFAULT_MAX_HOPS,
    DEFAULT_COUNT,
    DEFAULT_TIMEOUT,
    DEFAULT_PORT,
    DEFAULT_PACKET_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

STEP_USER_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
        vol.Required(CONF_HOST): cv.string,
        vol.Required(CONF_PROTOCOL, default=PROTOCOL_ICMP): vol.In(PROTOCOLS),
        vol.Optional(CONF_PORT, default=DEFAULT_PORT): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=65535)
        ),
        vol.Optional("interval", default=DEFAULT_INTERVAL): vol.All(
            vol.Coerce(int), vol.Range(min=10, max=3600)
        ),
        vol.Optional(CONF_MAX_HOPS, default=DEFAULT_MAX_HOPS): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=64)
        ),
        vol.Optional(CONF_COUNT, default=DEFAULT_COUNT): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=10)
        ),
        vol.Optional(CONF_TIMEOUT, default=DEFAULT_TIMEOUT): vol.All(
            vol.Coerce(float), vol.Range(min=0.5, max=10)
        ),
        vol.Optional(CONF_PACKET_INTERVAL, default=DEFAULT_PACKET_INTERVAL): vol.All(
            vol.Coerce(float), vol.Range(min=0.0, max=60.0)
        ),
    }
)


class MTRConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for MTR Network Monitor."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST]

            # Validate host is resolvable
            try:
                await self.hass.async_add_executor_job(socket.gethostbyname, host)
            except socket.gaierror:
                errors[CONF_HOST] = "invalid_host"
            else:
                # Check for duplicate
                await self.async_set_unique_id(f"{host}_{user_input[CONF_PROTOCOL]}")
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=user_input.get("name", host),
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_SCHEMA,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return MTROptionsFlow()


class MTROptionsFlow(config_entries.OptionsFlow):
    """Handle options for MTR Network Monitor."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = {**self.config_entry.data, **self.config_entry.options}

        schema = vol.Schema(
            {
                vol.Required(CONF_PROTOCOL, default=current.get(CONF_PROTOCOL, PROTOCOL_ICMP)): vol.In(PROTOCOLS),
                vol.Optional(CONF_PORT, default=current.get(CONF_PORT, DEFAULT_PORT)): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=65535)
                ),
                vol.Optional("interval", default=current.get("interval", DEFAULT_INTERVAL)): vol.All(
                    vol.Coerce(int), vol.Range(min=10, max=3600)
                ),
                vol.Optional(CONF_MAX_HOPS, default=current.get(CONF_MAX_HOPS, DEFAULT_MAX_HOPS)): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=64)
                ),
                vol.Optional(CONF_COUNT, default=current.get(CONF_COUNT, DEFAULT_COUNT)): vol.All(
                    vol.Coerce(int), vol.Range(min=1, max=10)
                ),
                vol.Optional(CONF_TIMEOUT, default=current.get(CONF_TIMEOUT, DEFAULT_TIMEOUT)): vol.All(
                    vol.Coerce(float), vol.Range(min=0.5, max=10)
                ),
                vol.Optional(CONF_PACKET_INTERVAL, default=current.get(CONF_PACKET_INTERVAL, DEFAULT_PACKET_INTERVAL)): vol.All(
                    vol.Coerce(float), vol.Range(min=0.0, max=60.0)
                ),
            }
        )

        return self.async_show_form(step_id="init", data_schema=schema)
