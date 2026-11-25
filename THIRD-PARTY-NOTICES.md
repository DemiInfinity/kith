# Third-party notices

Kith is AGPL-3.0 (see [LICENSE](LICENSE)). This lists other people's work it uses that isn't an ordinary npm or Cargo
dependency, or that's worth knowing about. Each npm and Cargo package keeps its own licence in its package.

## Pip's voice on the Mac (Kith.app)

The Mac app speaks Pip's replies with Kokoro on the Mac itself (`mac/src-tauri/src/voice.rs`, `kokoro.rs`; see
docs/macos.md). The model and voices are **not** in this repository or in the app: the app fetches them the first time
they're wanted, from Hugging Face at a fixed revision, and checks each file's SHA-256.

| What | Where from | Licence |
| --- | --- | --- |
| **Kokoro-82M** (the voice model), by hexgrad | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Apache-2.0 |
| **Kokoro-82M v1.0, ONNX** (`onnx/model.onnx`, the file Kith fetches) | [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231` | Apache-2.0 |
| **Kokoro voices** `bf_emma`, `bf_isabella`, `bf_lily`, `bf_alice`, `bm_fable`, `bm_george` (`voices/*.bin`) | the same repository and revision (they're Kokoro-82M's own voices) | Apache-2.0 |
| **Kokoro's phoneme vocabulary** (the table in `kokoro.rs`) | Kokoro-82M's `config.json` / the ONNX repository's `tokenizer.json` | Apache-2.0 |
| **misaki-rs** (English phonemes, with Misaki's British English dictionaries built in) | [crates.io/crates/misaki-rs](https://crates.io/crates/misaki-rs) | MIT |
| **Misaki** (the phonemiser and dictionaries misaki-rs ports), by hexgrad | [hexgrad/misaki](https://github.com/hexgrad/misaki) | Apache-2.0 |
| **ONNX Runtime** (runs the model; linked into the app on Apple silicon) | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime), via the [`ort`](https://crates.io/crates/ort) crate's prebuilt library | MIT (ONNX Runtime); MIT or Apache-2.0 (`ort`) |

Kith uses misaki-rs without its espeak-ng fallback (espeak-ng is GPL-3.0 and isn't included); words it doesn't know
are put together from parts it does know.

Apache-2.0: <https://www.apache.org/licenses/LICENSE-2.0>. MIT: <https://opensource.org/license/mit>.
