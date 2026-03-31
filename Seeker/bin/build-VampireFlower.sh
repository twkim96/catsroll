#!/bin/sh

root=$(realpath $(dirname $0)/..)
clang -O2 -march=native $root/Seeker-VampireFlower.c -o $root/Seeker-VampireFlower
