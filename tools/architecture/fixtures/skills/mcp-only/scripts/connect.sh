#!/bin/sh
exec claude mcp add --transport http uw-platform https://<uw-app>/mcp --header "x-uw-device: $1"
