# Design — 영파이 합주 시간 취합

A locked design system for this app. Every screen reads this file before
emitting code. Do not regenerate per screen — extend or amend this file when the
system needs to grow.

Reference: `design-ref.md` (토스 디자인 시스템). We borrow its **visual language**
— white canvas, cool-grey hierarchy, one accent per screen, flat surfaces with
1px hairlines, aggressive radius ladder, 56px bottom CTA, press-overlay feedback,
Pretendard, 해요체 — and swap the accent from Toss blue to **yellow**, keeping the
band's mascot as the one character moment. We do not borrow any finance concepts.

## Genre
modern-minimal (with one playful character)

## Macrostructure family
- Intro (`#/`): deliberately kept from the earlier (Hum) look — cream canvas, chunky pear mascot with a solid edge shadow, wordmark, one line, one pill push button "시작하기". Intro-only tokens live under `--intro-*` in tokens.css; nothing else on the app uses them.
- App pages (홈 · 새 취합 · 결과 달력 · 입력 달력 · 관리): **Workbench** — the calendar is the product surface. 56px top app bar (left title, 40px chevron back, small mascot right). Screens are a single column of white cards with hairlines; section headers are `title-1`.

## Theme (custom · tokens.css)
- Canvas `--color-bg` white · secondary surface `grey-100` · dividers `grey-200` (1px)
- Text `grey-900` (never black) · secondary `grey-700` · tertiary navy@58% · placeholder navy@28%
- Accent `--color-brand` yellow-500 oklch(0.853 0.156 86) — one primary action per screen, 확정된 날, 진행 막대, 다음 합주 히어로 블록
- Accent weak `yellow-50` — 전원 가능한 날, 확정 알림 배경
- Danger `red-500` / weak — 불가 표시, 삭제. Success `green-500` / weak — "모두 제출" 배지
- Saturday numbers `blue-500`, Sunday/holiday numbers `red-500` (calendar convention only)
- Press state: black 26% overlay. Disabled: whole node at 30% opacity.

## Typography
- Pretendard Variable (CDN). h1 28/700, h4 20/700 (app bar title), title-1 18/600 (section heads, card titles), body-2 15/400 (default), body-3 13, caption 12/500.
- tabular-nums everywhere; no uppercase labels; no italic.

## Spacing & shape
- 4pt scale; 24px outer gutter (20px under 360px); 16px between rows.
- Radius: inputs 12 · L button 14 · cards/XL button 16 · sheet 24 · hero 32 · chips 999.
- No decorative 2px borders, no left accent rails, no gradients except the bottom-CTA protection gradient.

## Motion
- `--ease` cubic-bezier(0.22,0.61,0.36,1) · `--ease-out` for sheets · 120 / 200 / 320 ms. No bounce, no lift-on-hover.
- Mascot breathes and blinks; a yellow star bursts once on 확정.
- Reduced-motion: animations off, transitions ≤100ms.

## Components
- Buttons XL 56 / L 48 / M 40 (.small) / S 32 (.xs). Primary = yellow + grey-900 text. Neutral = grey-100. Ghost = text only. Danger = red + white.
- Bottom CTA: fixed 56px, white→transparent gradient above, safe-area aware. Never together with an in-screen primary button.
- Text field 48px grey-100 → focus white + 1.5px yellow-600. Labels above inputs.
- Chip 36px hairline pill; active flips to grey-900/white. Badge 22px, radius 6, washed semantic background.
- Switch 44×26, on = yellow. Progress bar grey-200 track + yellow fill. Stepper: 24px nodes, done/current yellow.
- Bottom sheet: radius 24 top, scrim black 56%, handle. Toast: grey-900, radius 14.
- Calendar cell: white hairline 12px radius. 전원 가능 = yellow-50 fill · 한 명 빼면 = dashed yellow-600 border · 불가 = grey-100 with grey-400 number · 확정 = yellow-500 + ★ · (입력) 불가 = red-50 with red text · 일부 불가 = yellow-50.

## Copy
해요체, 버튼은 일어날 일을 말함 ("시작하기", "저장", "확정"). 이모지는 문장 안에 쓰지 않음.
