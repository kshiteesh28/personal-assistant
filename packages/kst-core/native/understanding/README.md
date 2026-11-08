# Adaptive classifier kernel

Build with the same Node 22.23+ installation used to run the core:

```sh
node packages/kst-core/native/understanding/build.mjs
node packages/kst-core/native/understanding/prepare-seed.mjs
node --test packages/kst-core/test/understanding/model.test.mjs
node packages/kst-core/native/understanding/evaluate.mjs
```

The build uses the installed Node header directory and Apple's existing clang toolchain. Set `KST_NODE_INCLUDE` only if the headers live outside the Node installation. There is no dependency download. Target: macOS 14+, arm64, Node-API 9. Compiler options disable floating point contraction and fast math. Build artifacts and the compiler manifest are under ignored `build/`; packaging must build/copy/sign the addon. Failure to build/load it selects the JS reference.

The addon owns a copy of each validated artifact until `dispose(handle)` or garbage collection. It exposes `loadModel(Buffer)`, `predict(handle, Uint16Array, Float32Array)`, `dispose(handle)`, and synchronous `train(records, options, Int32Array)` for a dedicated worker. Training records have `label`, compact `featureBuffer`, optional `personal` and 16-byte `id`. Options include safe-integer model/dataset/privacy counters, 32-byte `corpusHash`, 512-byte `policyBytes`, and `deadlineMs` no greater than 10000. Cancellation flag is a one-element Int32Array over SharedArrayBuffer, set with `Atomics.store`; the native loop reads it atomically between samples. Training has no file or executor access.

`prepare-seed.mjs` produces a deterministic scaffold model and replay corpus. The action source has 208 synthetic phrase groups; separate lists provide 80 train and 64 gate negative groups. Repeated scaffold rows exercise the required replay/train path but do not increase independent evidence. They are explicitly identified in `seed-manifest.json` and evaluation output. All automatic policies remain disabled. This dataset does **not** meet the specification's independent development/release corpus requirements; active release must remain blocked. Expand the separately grouped dataset and conduct calibration before changing that status.

`evaluate.mjs` compares PA-I and a development logistic-SGD baseline on the same small grouped scaffold, reports per-class counts and five feature+score timing runs (100 warmup, 10000 samples each). It records unavailable fastText as an incomplete comparison. These measurements do not assert production accuracy or full end-to-end latency.
