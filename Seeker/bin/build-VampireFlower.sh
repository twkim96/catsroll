#!/bin/sh

root=$(readlink -f "$(dirname "$0")"/..)
${CC:-clang} -O2 "$root/Seeker-VampireFlower.c" -o "$root/Seeker-VampireFlower"
