// Web Worker for the client-side ("내 기기 연산") VampireFlower seed seeker.
//
// It loads the Emscripten-compiled seeker (seeker-vampireflower.js + .wasm),
// runs the search off the main thread, and posts the result back. This is the
// Stage 1 single-threaded path; it does not touch the server seek flow.
//
// Protocol:
//   in : { rates: [rare, supa, uber, legend],
//          slots: [rare, supa, uber, legend],
//          rolls: [rarityValue, slot, ...] }   // flat pairs, rarityValue 2..5
//   out: { ok: true, status, begin, end, count }   // status 0 none, 1 one, 2 many
//        { ok: false, error }

let modulePromise = null;

function getModule() {
  if (!modulePromise) {
    // Resolve relative to this worker's own URL so it works under /asset.
    importScripts('seeker-vampireflower.js');
    modulePromise = createSeekerModule();
  }
  return modulePromise;
}

self.onmessage = async (event) => {
  const { rates, slots, rolls } = event.data || {};

  try {
    const Module = await getModule();

    const nCats = rolls.length / 2;
    const rollsPtr = Module._malloc(rolls.length * 4);
    const outPtr = Module._malloc(4 * 4);

    for (let i = 0; i < rolls.length; i++) {
      Module.setValue(rollsPtr + i * 4, rolls[i], 'i32');
    }

    Module.ccall(
      'seek_seed',
      null,
      ['number', 'number', 'number', 'number',
       'number', 'number', 'number', 'number',
       'number', 'number', 'number'],
      [rates[0], rates[1], rates[2], rates[3],
       slots[0], slots[1], slots[2], slots[3],
       rollsPtr, nCats, outPtr]
    );

    const status = Module.getValue(outPtr, 'i32') >>> 0;
    const begin = Module.getValue(outPtr + 4, 'i32') >>> 0;
    const end = Module.getValue(outPtr + 8, 'i32') >>> 0;
    const count = Module.getValue(outPtr + 12, 'i32') >>> 0;

    Module._free(rollsPtr);
    Module._free(outPtr);

    self.postMessage({ ok: true, status, begin, end, count });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error && error.message || error) });
  }
};
