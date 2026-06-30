// WebAssembly driver for the VampireFlower seed seeker.
//
// This file reuses the exact algorithm and globals from
// Seeker-VampireFlower.c (xorshift32, simulate_rolls, verify_seed,
// sanitize_range, find_seed_fast, determine_fastest_approach) by including
// that translation unit with SEEKER_WASM defined, which excludes the native
// pthread driver and main(). The native build is unaffected.
//
// It runs single-threaded (thread_count = 1, thread_id = 0), which covers the
// entire 2^32 search space through the existing last-thread range logic in
// sanitize_range(). Multi-threading (pthreads + SharedArrayBuffer + COOP/COEP)
// is intentionally deferred to a later optimization stage.

#define SEEKER_WASM
#include "Seeker-VampireFlower.c"

#include <emscripten/emscripten.h>

// Inputs mirror the native argv contract (see route.rb#seek_source):
//   rates:  rare, supa, uber, legend            (rare is unused, kept for parity)
//   slots:  rare, supa, uber, legend            (number of cats per rarity)
//   rolls:  flat pairs [rarity_value, slot, ...] where rarity_value is 2..5
//   n_cats: number of (rarity, slot) pairs
//
// Output (caller-allocated uint[4]):
//   out[0] = status: 0 = none, 1 = exactly one seed, 2 = multiple matches
//   out[1] = seed_begin
//   out[2] = seed_end
//   out[3] = number of matches found (>= 2 means ambiguous)
EMSCRIPTEN_KEEPALIVE
void seek_seed(
    int rare_rate, int supa_rate, int uber_rate, int legend_rate,
    int s_rare, int s_supa, int s_uber, int s_legend,
    const int* rolls, int n_cats,
    unsigned* out) {

    (void)rare_rate; // rare rarity is the remainder; not needed by the seeker

    LEGEND_CHANCE = 10000 - legend_rate;
    UBER_CHANCE = LEGEND_CHANCE - uber_rate;
    SUPER_CHANCE = UBER_CHANCE - supa_rate;

    RARITY_SIZES[0] = s_rare;
    RARITY_SIZES[1] = s_supa;
    RARITY_SIZES[2] = s_uber;
    RARITY_SIZES[3] = s_legend;

    USER_NCATS = (uint)n_cats;
    cats = malloc(sizeof(Cat) * USER_NCATS);

    if (!cats) {
        out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
        return;
    }

    for (uint i = 0; i < USER_NCATS; i++) {
        cats[i].rarity = rolls[i * 2] - 2;
        cats[i].slot   = rolls[i * 2 + 1];
    }

    found_seeds = 0;
    seed_begin = 0;
    seed_end = 0;
    thread_count = 1;

    uint low, high; // inclusive, exclusive
    switch (cats[0].rarity) {
    case RARE:        low = 0;             high = SUPER_CHANCE;  break;
    case SUPER_RARE:  low = SUPER_CHANCE;  high = UBER_CHANCE;   break;
    case UBER_RARE:   low = UBER_CHANCE;   high = LEGEND_CHANCE; break;
    case LEGEND_RARE: low = LEGEND_CHANCE; high = 10000;         break;
    default:
        free(cats);
        out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
        return;
    }

    bool method =
        determine_fastest_approach(high - low, RARITY_SIZES[cats[0].rarity]);

    ThreadArgs arg;
    arg.method = method;
    arg.thread_id = 0;
    arg.low = low;
    arg.high = high;
    arg.start = 0;
    arg.end = 0;

    find_seed_fast(&arg);

    out[0] = found_seeds;
    out[1] = seed_begin;
    out[2] = seed_end;
    out[3] = found_seeds;

    free(cats);
}
