#!/bin/sh

set -eu

if [ -d /host.git ]; then
  git -C /battle-cats-rolls pull /host.git
else
  git -C /battle-cats-rolls pull https://gitlab.com/godfat/battle-cats-rolls.git
fi

echo "Running $(git -C /battle-cats-rolls rev-parse HEAD)"
exec "$@"
