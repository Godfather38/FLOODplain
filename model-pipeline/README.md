# Companion model-pipeline patch

App and native model execution currently use separate branches. This patch applies to the existing model branch baseline 4af428ab42718d9b2aa18f7cd9cba2825a4fc4ce; verified model implementation commit 1c3363f. It is included for review, not automatically applied or deployed by this app build.

Apply only in an isolated checkout of the model branch after checking the baseline:

    git apply --check picture-rocks-exporter.patch
    git apply picture-rocks-exporter.patch
    python -m unittest discover -s tools/live -p 'test_*.py'

Then review and authorize activation on the actual model branch. A newly completed native run must use the exporter before the production service changes. No replay has been substituted or republished as a new forecast. The app build alone cannot activate the correction.

The attached evidence explains strict bounds, raw data preservation, unknown cases, the 80 portable tests, and validation against both real forecast packages. Full POSIX publication harness remains a Linux check. No new dependencies or solver setting changes.
