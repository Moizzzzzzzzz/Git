# Report renderer assets

Copy **this whole directory** to `dist/vcans-orders/assets/` when building the API image.
The renderer resolves assets relative to `__dirname`, or accepts an explicit trusted `assetDir`.
Missing assets fail generation; it does not silently fall back to an unembedded font.

- `NotoSansCJKsc-Medium.otf`: unmodified upstream Simplified Chinese font, SIL OFL 1.1.
  Source: https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Medium.otf
  SHA-256: `ca094f6b0001fb048ca39ddd797a0cdb0179e1e55c6561e111c49c3e6a61d7b7`.
  License in `OFL.txt` (https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE).
  Keep that license with redistributed images/bundles. This font is embedded/subset in generated PDFs.
- `yongsheng-group-blue.png`: 600 dpi crop of the user-provided official PDF's top-right horizontal logo,
  excluding dimension marks. Source archive: `ysfabric/需求附件/永盛集团LOGO（蓝色）.pdf`.
  Original PDF SHA-256: `5c5216ca221667423d7d10f2c2311cd8cf0a41cbd825200e96668322d26812ae`.
  Asset SHA-256: `07a923c48b2350cf032a6a877743f4b4f8c393efa2eb5696a0ef3b35fb38f01e`.
  The brand asset remains the user's supplied artwork; it is not covered by the font license.

The renderer performs no network requests, database access, authorization or persistence.
The caller must supply an authorized confirmed immutable snapshot and previously validated/fetched photo bytes.
Do not regenerate an existing issued report version from mutable live order data.
Store the successful Buffer once per immutable report version and retain its hash.

Label default size is 100 × 70 mm **for preview only**, pending printer/media selection.
`LabelOptions` accepts width 70–150 mm and height 50–150 mm. Overlong content/dense QR fails
with a clear error instead of shrinking text beyond legibility or silently clipping data.
The code preserves the supplied QR payload, renders a vector QR with four-module quiet zone,
and prints the human-readable payload. It does not connect to a 4G printer.
