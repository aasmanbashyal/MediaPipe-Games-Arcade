# Third-party references

## Inference runtime and models

- [LiteRT.js](https://developers.google.com/edge/litert/web), package
  `@litertjs/core` version 2.6.0, uses the Apache-2.0 license. Runtime code and
  WebAssembly are loaded from the versioned jsDelivr URL only after camera intent.
- [fflate](https://github.com/101arrowz/fflate), version 0.8.2, uses the MIT license.
  It unpacks the downloaded model bundle in the worker.
- The official [MediaPipe Gesture Recognizer model bundle](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer#models)
  is pinned to the `float16/1` release. It contains the palm, landmark, embedding,
  and classification TFLite graphs. No model binary is committed here.

## Geometry and model adaptation

`shared/hand-model-math.js` implements the algorithms and constants from the
MediaPipe graphs and calculators in JavaScript. The source material is copyright
The MediaPipe Authors and licensed under Apache-2.0:

The upstream license and bundled notices are included in [licenses/MediaPipe-LICENSE.txt](licenses/MediaPipe-LICENSE.txt).

- [Hand detector graph](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/hand_detector/hand_detector_graph.cc)
- [Hand landmark graph](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/hand_landmarker/hand_landmarks_detector_graph.cc)
- [Landmark normalization](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/tensor/landmarks_to_tensor_calculator.cc)
- [MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)

`shared/tflite-batch.js` uses field definitions from the
[TFLite FlatBuffer schema](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/schema/schema.fbs).
Before compilation it replaces dynamic batch signatures with their existing
fixed batch-one shapes. Model weights and non-batch dimensions are unchanged.

Optional live tests download `right_hands.jpg`, `woman_hands.jpg`, and `fist.jpg`
from Google's MediaPipe test-asset bucket and verify their SHA-256 hashes. They
are test fixtures only and are not redistributed in this repository.

