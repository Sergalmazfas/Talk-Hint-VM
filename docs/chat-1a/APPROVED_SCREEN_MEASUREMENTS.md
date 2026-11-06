# TalkHint chat — approved screen measurement reference

**Authority:** `attached_assets/0_IMG_4200_1793933763767.jpeg` (960 × 1517 px). This is the large, owner-approved reference. The second attached image is context only and is not a target for this screen. No implementation mockup is specified here.

## Measurement basis

Coordinates below are estimated by reading the source JPEG pixels, not from device metadata. The photographed/rendered phone interior is approximately **x=50–940 px** wide (about 890 px). For comparison only, that interior is normalized to **390 logical points**, giving **2.28 source px/pt**. A 390 pt base width is an assumption, not a known device size or screenshot scale. Estimates are rounded; allow roughly **±8–16 px** (about ±4–7 pt) for softened edges, crop, perspective, and manual boundary selection. Text bounds and font sizing have greater uncertainty.

Bounds use source-image coordinates `(left, top)–(right, bottom)`, origin at the image’s top-left. The approximate normalized point bounds use the same origin and divide source pixels by 2.28; they are reference coordinates, not safe-area or Auto Layout constants. The image is clipped at the top of the device, so status-bar, notch, and top safe-area geometry cannot be recovered reliably.

## Visible geometry

| Element | Approx. source pixel bounds | Approx. normalized bounds (pt) | Notes |
|---|---:|---:|---|
| Phone display interior | (50, 0)–(940, 1500) | (22, 0)–(412, 658) | Side edges and bottom are visible; top is cropped. Interior width is the normalization basis. |
| Header control row | (88, 55)–(905, 165) | (39, 24)–(397, 72) | One back control at left, centered folder + “TalkHint Chat” title, ellipsis at right. |
| Back circular control | (89, 59)–(194, 164) | (39, 26)–(85, 72) | Roughly 46 pt visual diameter; retain a touch target of at least 44 × 44 pt. |
| Center title / folder | (319, 86)–(680, 131) | (140, 38)–(298, 57) | Bold, centered; icon precedes title. |
| More circular control | (798, 59)–(905, 164) | (350, 26)–(397, 72) | Three-dot icon. |
| Date/time label | (425, 216)–(568, 246) | (186, 95)–(249, 108) | Centered “Сегодня, 9:41”; muted gray. |
| User bubble 1 | (275, 262)–(904, 412) | (121, 115)–(397, 181) | Right aligned; pale green; two lines. |
| Assistant bubble 1 | (89, 444)–(776, 644) | (39, 195)–(341, 283) | Left aligned; pale lavender; three lines. |
| User bubble 2 | (274, 678)–(904, 825) | (120, 298)–(397, 362) | Right aligned; pale green; two lines. |
| Assistant bubble 2 | (89, 861)–(775, 1007) | (39, 378)–(340, 442) | Left aligned; pale lavender; two lines. |
| Assistant answer bubble | (121, 1031)–(899, 1255) | (53, 452)–(394, 551) | Left aligned, inset farther than prior bubble; pale lavender; three lines plus copy glyph near lower-right. |
| Composer capsule | (89, 1342)–(742, 1462) | (39, 589)–(325, 641) | Left-side plus, placeholder, microphone; thin light border and large rounded ends. |
| Separate Orb control | (783, 1345)–(904, 1462) | (343, 590)–(397, 641) | Black circular waveform control, visually about 52 × 51 pt. Implement separately at **48 × 48 pt** as required; maintain the visible gap from composer. |

## Visual / UIKit guidance

- Preserve the quiet, readable, full-screen conversation composition: white-to-near-white canvas, generous vertical rhythm, centered date, alternating left/right message groups, composer at the bottom, and a separate black Orb. Do not add sidebar, projects, tabs, or other screens/functions.
- Message bubbles are soft, low-contrast fills rather than saturated colors. JPEG interior samples are approximately **#ECFAE0** for green and **#F3EFFF** for lavender; treat these as approximate because of image compression and sampling. Use rounded corners around **20–24 pt** and content insets around **16–18 pt** as implementation starting points.
- Body glyph height and line wrap suggest a readable body face around **20 pt** at the assumed 390 pt width. This is a visual estimate, **not an exact font-size measurement and not an SF font identification**. Start near 20 pt, then compare line wrapping and density against the reference; use Dynamic Type/accessibility scaling.
- Header title appears bold, around **18–20 pt** estimated. Date label appears around **12–14 pt**, regular and muted. Both estimates are uncertain from rasterized pixels.
- Keep all controls comfortably actionable: **at least 44 × 44 pt** hit areas for back, more, attachment, microphone, send, and other buttons. The Orb is a distinct visual button at **48 × 48 pt**, not merged into the composer.
- The pictured composer is a single rounded input capsule with plus at left, placeholder text, and microphone at right; the Orb sits independently outside it. Preserve those relative relationships and the soft green/lavender message distinction.

These dimensions are an image-based reference, not a claim about the owner’s physical iPhone model, pixel density, exact system font, safe-area insets, or production layout constraints.
