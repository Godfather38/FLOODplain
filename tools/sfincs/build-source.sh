#!/usr/bin/env bash
set -euo pipefail
# Official GPL-3.0 source, never the separately licensed downloadable binary.
commit=f3647fc0289bb15cb2512d60686cef74cb853c78
destination="${1:?Supply an empty build directory}"
git clone https://github.com/Deltares/SFINCS.git "$destination"
git -C "$destination" checkout --detach "$commit"
test "$(git -C "$destination" rev-parse HEAD)" = "$commit"
cd "$destination/source"
export FCFLAGS='-fopenmp -O3 -fallow-argument-mismatch -w'
export FFLAGS="$FCFLAGS"
autoreconf -vif
./configure --disable-openacc
# Upstream Fortran module dependencies require ordered serial compilation.
make -j1
test -x src/sfincs
