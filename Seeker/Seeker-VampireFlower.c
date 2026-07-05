#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

typedef uint32_t uint;

#ifdef _WIN32
  #include "pthread-win32/pthread.h"
  #include <windows.h>
  #define PROCESS_PRIORITY_HIGH() SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS)
#else
  #include <pthread.h>
  #include <unistd.h> // to query core count
#define PROCESS_PRIORITY_HIGH() do {} while (0)
#endif


#ifndef FORCE_INLINE
  #if defined(_MSC_VER)
    #define FORCE_INLINE __forceinline
  #elif defined(__GNUC__) || defined(__clang__)
    #define FORCE_INLINE static inline __attribute__((always_inline))
  #else
    #define FORCE_INLINE static inline
  #endif
#endif


typedef enum {
    RARE,
    SUPER_RARE,
    UBER_RARE,
    LEGEND_RARE,
} rarity;


uint RARITY_SIZES[4];

uint SUPER_CHANCE;
uint UBER_CHANCE;
uint LEGEND_CHANCE;

uint found_seeds;
uint seed_begin;
uint seed_end;
uint thread_count;

// run 0: search that assumes the first slot is not the result of a duplicate rare
// run 1: search assumes the first slot is smaller than the shadow pull
// run 2: search assumes the first slot is greater than the shadow pull
uint RUN;

typedef struct {
    rarity rarity;
    uint slot;
} Cat;

uint USER_NCATS;
Cat* cats; // globally accessible pointer to array of cats


// pass by reference
static inline uint xorshift32(uint* seed) {
    uint x = *seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 15;
    return *seed = x;
}

// pass by value
static inline uint reverse_xorshift32(uint seed, uint steps) {

    for (uint i = 0; i < steps; i++) {
        seed ^= seed << 15;
        seed ^= seed << 30;
        seed ^= seed >> 17;
        seed ^= seed << 13;
        seed ^= seed << 26;
    }

    return seed;
}

/*/
* Even though 10000 is a compile-time constant, neither
* GCC nor MSVC optimized n % 10000 to use magic numbers
* A visualization of what's going on under the hood:
*
*   print(123456789 * (2**45 // 10000) // 2**45)  ->  12345
*   print(12345 * 10000)                          ->  123450000
*   print(123456789 - 123450000)                  ->  6789
*   print(123456789 % 10000)                      ->  6789
/*/
static inline uint mod_10000(uint n) {
    return n - (((uint64_t)n * 3518437209) >> 45) * 10000;
}


FORCE_INLINE bool simulate_rolls(uint* seed, uint start) {

    for (uint j = start; j < USER_NCATS; j++) {

        xorshift32(seed);

        // ignore the rarity check. the number of early exits from checking
        // if the rarity matches is not worth the unpredictable branches

        uint slot = xorshift32(seed) % RARITY_SIZES[cats[j].rarity];

        if (cats[j].rarity == RARE) {
            if (slot == cats[j-1].slot && cats[j-1].rarity == RARE) { // duplicate rare cat!!!
                uint newslot = xorshift32(seed) % (RARITY_SIZES[0] - 1);
                slot = newslot + (newslot >= slot);
            }
        }

        if (slot != cats[j].slot)
            return false;
    }
    return true;
}


// accurate, but slower. run to weed out false positives
FORCE_INLINE bool verify_seed(uint seed) {

    for (uint j = 0; j < USER_NCATS; j++) {

        // first cat is the result of a duplicate rare, ignore it
        if (RUN != 0 && j == 0) {
            xorshift32(&seed);
            xorshift32(&seed);
            xorshift32(&seed);
            continue;
        }

        uint temp = mod_10000(xorshift32(&seed));

        rarity pulled_rarity = (temp >= SUPER_CHANCE)
                             + (temp >= UBER_CHANCE)
                             + (temp >= LEGEND_CHANCE);

        if (pulled_rarity != cats[j].rarity)
            return false;

        uint slot = xorshift32(&seed) % RARITY_SIZES[pulled_rarity];

        if (j > 0 && pulled_rarity == RARE) {
            if (slot == cats[j-1].slot && cats[j-1].rarity == RARE) { // duplicate rare cat!!!
                uint newslot = xorshift32(&seed) % (RARITY_SIZES[0] - 1);
                slot = newslot + (newslot >= slot);
            }
        }

        if (slot != cats[j].slot)
            return false;
    }
    return true;
}



// a struct to hold all the arguments necessary to run find_seed_fast
typedef struct {
    bool method; // 1 if rarity check is faster, 0 if slot check is faster
    uint thread_id;
    uint low;  // inclusive
    uint high; // exclusive
    uint start;
    uint end;
    uint seed_begin;
    uint seed_end;
    uint found_seeds;
} ThreadArgs;


FORCE_INLINE void set_start_and_end(ThreadArgs* arg) {

    uint thread_id = arg->thread_id;
    uint low   = arg->low;
    uint high  = arg->high;
    uint start = (UINT32_MAX / thread_count) * thread_id;
    uint end   = (UINT32_MAX / thread_count) * (thread_id + 1);

    if (arg->method) { // rarity method

        if (mod_10000(start) < high) { // we landed before/in a range, move to its start.
            start -= mod_10000(start); // set lowest 4 digits to 0
            start += low;
        } else { // we landed after a range, move to the next one.
            start -= mod_10000(start);
            start += low + 10000;
        }

        if (thread_id < thread_count - 1) {

            if (mod_10000(end) < high) { // we landed before/in a range. go to the end of the previous range
                end -= mod_10000(end) + 10000;
                end += high;
            } else if (mod_10000(end) > high) { // we landed after a range, go to the end of it
                end -= mod_10000(end);
                end += high;
            }
            // do nothing if end % 10000 == high
        }
        else // assign all the leftover values to the last thread
            end = (high > 7295) ? UINT32_MAX : 4294960000 + high;
    }

    else { // slot method

        // suppose the first cat's slot is 7 (b), with 25 (m) cats in its rarity.
        // this means numbers 7, 25+7, 50+7, 75+7... would pull that same cat
        // we can skip unnecessary values by jumping forward by m each iteration

        uint m = RUN == 0 ? RARITY_SIZES[cats[0].rarity]:
                            RARITY_SIZES[cats[0].rarity] - 1;

        uint b = RUN == 2 ? cats[0].slot - 1 : cats[0].slot;

        // if start is not already a multiple of m, move forward
        if (start % m)
            start += (m - (start % m));

        start += b;

        // always move end to the previous multiple of m (+ b)
        // if end is already a multiple, subtract m so that this thread's
        // end does not overlap with the next thread's start.
        if (thread_id < thread_count - 1) {
            if (end % m)
                end -= end % m;
            else
                end -= m;

            end += b;
        }
        else // last thread special case
            end = UINT32_MAX - ((UINT32_MAX - b) % m);

    }

    arg->start = start;
    arg->end = end;

}


void* find_seed_fast(void* args) {
    ThreadArgs* arg = (ThreadArgs*)args;

    // determine the range of values this thread should process
    set_start_and_end(arg);

    if (arg->method) { // rarity algorithm

        uint jump = 10000 - (arg->high - arg->low);

        for (uint64_t i = arg->start; i < arg->end; i += jump) {
            for (uint to_check = 10000 - jump; (i < arg->end || i == UINT32_MAX) // exclusive, except at UINT32_MAX
                && (to_check > 0); i++, to_check--) {

                uint seed = i; // i is already the result of the first PRNG call

                uint slot = xorshift32(&seed) % RARITY_SIZES[cats[0].rarity];

                if (slot != cats[0].slot) continue;

                // if we've made it here, cats[0] must be matching
                // take a candidate seed and check if cats[1]->cats[n] match
                if (simulate_rolls(&seed, 1)) {

                    uint begin = reverse_xorshift32(i, 1);
                    if (verify_seed(begin)) {
                        arg->seed_begin = begin;
                        arg->seed_end = seed;
                        arg->found_seeds++;

                        if (arg->found_seeds > 1)
                            return NULL;
                    }
                }
            }
        }
    }

    else { // slot algorithm

        uint m = RUN == 0 ? RARITY_SIZES[cats[0].rarity] :
                            RARITY_SIZES[cats[0].rarity] - 1;

        for (uint64_t i = arg->start; i <= arg->end; i += m) {
            uint seed = i;

            // take a candidate seed and check if cats[1]->cats[n] match
            if (simulate_rolls(&seed, 1)) {

                uint begin = reverse_xorshift32(i, 2 + (RUN > 0));

                if (verify_seed(begin)) {
                    arg->seed_begin = begin;
                    arg->seed_end = seed;
                    arg->found_seeds++;

                    if (arg->found_seeds > 1)
                        return NULL;
                }
            }
        }
    }
    return NULL;
}


// "cost" represents roughly how many candidate seeds that would be checked
bool determine_fastest_approach(uint rarity_range, uint rarity_count) {

    uint rarity_cost = (UINT32_MAX / 10000) * rarity_range;
    uint slot_cost = (UINT32_MAX / rarity_count) * 1.5;

    return (rarity_cost < slot_cost);
}


void run_search_threads(
    pthread_t* threads,
    ThreadArgs* args,
    uint thread_count,
    bool method,
    uint low,
    uint high
) {
    for (uint i = 0; i < thread_count; i++) {
        args[i].method = method;
        args[i].thread_id = i;
        args[i].low = low;
        args[i].high = high;
        args[i].found_seeds = 0;
        pthread_create(&threads[i], NULL, find_seed_fast, &args[i]);
    }

    for (uint i = 0; i < thread_count; i++) {
        pthread_join(threads[i], NULL);
    }

    found_seeds = 0;
    // merge thread-local results after all threads are done
    for (uint i = 0; i < thread_count; i++) {
        if (args[i].found_seeds > 0 && found_seeds == 0) {
            seed_begin = args[i].seed_begin;
            seed_end = args[i].seed_end;
        }
        found_seeds += args[i].found_seeds;
    }
}


int main(int argc, char* argv[]) {

    if (argc % 2 || argc < 12) {
       printf("bad arguments");
       return -1;
    }

    LEGEND_CHANCE = 10000 - atoi(argv[5]);
    UBER_CHANCE = LEGEND_CHANCE - atoi(argv[4]);
    SUPER_CHANCE = UBER_CHANCE - atoi(argv[3]);
    RARITY_SIZES[0] = atoi(argv[6]); // number of rare cats on the banner
    RARITY_SIZES[1] = atoi(argv[7]); // number of super rare cats on the banner
    RARITY_SIZES[2] = atoi(argv[8]); // number of uber cats on the banner
    RARITY_SIZES[3] = atoi(argv[9]); // number of legend rare cats on the banner

    USER_NCATS = (argc - 10) / 2; // cats start at argv 10
    cats = malloc(sizeof(Cat) * USER_NCATS);

    if (!cats) {
        fprintf(stderr, "malloc error.\n");
        return 1;
    }

    for (uint i = 0, j = 10; i < USER_NCATS; i++) {
        cats[i].rarity = atoi(argv[j++]) - 2;
        cats[i].slot   = atoi(argv[j++]);
    }

#ifdef _WIN32
    SYSTEM_INFO sysinfo;
    GetSystemInfo(&sysinfo);
    thread_count = sysinfo.dwNumberOfProcessors;
#else
    thread_count = sysconf(_SC_NPROCESSORS_ONLN);
#endif


    uint low, high; // inclusive, exclusive
    switch (cats[0].rarity) {
        case RARE:
            low = 0;
            high = SUPER_CHANCE;
            break;
        case SUPER_RARE:
            low = SUPER_CHANCE;
            high = UBER_CHANCE;
            break;
        case UBER_RARE:
            low = UBER_CHANCE;
            high = LEGEND_CHANCE;
            break;
        case LEGEND_RARE:
            low = LEGEND_CHANCE;
            high = 10000;
            break;
    }

    pthread_t* threads = malloc(thread_count * sizeof(pthread_t));
    ThreadArgs* args   = malloc(thread_count * sizeof(ThreadArgs));

    if (!args || !threads) {
        fprintf(stderr, "malloc error.\n");
        return 1;
    }

    bool method = determine_fastest_approach(high - low, RARITY_SIZES[cats[0].rarity]);


    run_search_threads(threads, args, thread_count, method, low, high);


    if (found_seeds == 0 && cats[0].rarity == RARE) { // assume the first cat was the result of a duplicate rare

        if (cats[0].slot == 0) { // run type 2 is conceptually invalid when slot is 0
            RUN = 1;
            run_search_threads(threads, args, thread_count, method, low, high);
        }

        else if  (cats[0].slot == RARITY_SIZES[0]-1) { // run type 1 is invalid with the last slot
            RUN = 2;
            run_search_threads(threads, args, thread_count, method, low, high);
        }

        else {
            bool prefer_run_1 = cats[0].slot < RARITY_SIZES[0] / 2;

            RUN = prefer_run_1 ? 1 : 2;

            run_search_threads(threads, args, thread_count, method, low, high);

            if (found_seeds == 0) {
                RUN = prefer_run_1 ? 2 : 1;
                run_search_threads(threads, args, thread_count, method, low, high);
            }

        }
    }

    if (found_seeds == 0)
        printf("No seeds found.\n");
    else
        printf("%u\n%u\n%u\n%u\n", seed_begin, seed_end, found_seeds, RUN);

    free(cats);
    free(args);
    free(threads);

    return 0;
}
