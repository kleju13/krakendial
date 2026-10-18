// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
//! The logo: the dial's pixel kraken on a navy tile, drawn pixel for pixel at any size. The tray
//! draws it as it runs; build.rs makes the exe's icon and the pages' favicon from it, and
//! assets/icon.svg is the same drawing for the README.

/// The kraken of the fetch layouts (MASCOTS in web/dial.js, first frame, without its empty first
/// and last columns), looking right: X body, o highlight, W eye white, K pupil.
const KRAKEN: [&str; 12] = [
    "....XXXXXX....",
    "..XooXXXXXXX..",
    ".XoXXXXXXXXXX.",
    "XXXXXXXXXXXXXX",
    "XXXWKXXXXWKXXX",
    "XXXWKXXXXWKXXX",
    "XXXXXXXXXXXXXX",
    ".XXXXXXXXXXXX.",
    ".XX.XX..XX.XX.",
    "XX..XX..XX..XX",
    "X..XX....XX..X",
    "...X......X...",
];

/// Where the pixels go when a size isn't a multiple of the kraken's: the eyes first, both
/// columns of each together, then the columns in pairs either side of the middle, so it stays
/// symmetric. Rows likewise, from the eyes out.
const COLS: [&[usize]; 6] = [&[3, 4, 9, 10], &[6, 7], &[0, 13], &[1, 12], &[2, 11], &[5, 8]];
const ROWS: [&[usize]; 11] = [&[4, 5], &[3], &[6], &[9], &[1], &[7], &[10], &[2], &[8], &[0], &[11]];

/// RGB: the tile from top to bottom, the red dot.
const TOP: [u8; 3] = [0x14, 0x26, 0x4a];
const BOTTOM: [u8; 3] = [0x0a, 0x14, 0x26];
const RED: [u8; 3] = [0xdc, 0x26, 0x26];

fn paint(c: u8) -> Option<[u8; 3]> {
    match c {
        b'X' => Some([0x60, 0xa5, 0xfa]),
        b'o' => Some([0xbf, 0xdb, 0xfe]),
        b'W' => Some([0xf7, 0xfa, 0xff]),
        b'K' => Some([0x0b, 0x1a, 0x2e]),
        _ => None,
    }
}

/// For each of `n` pixels, the column (or row) of the kraken it shows, if any: `count` cells
/// over `total` pixels, centred.
fn spans(n: usize, count: usize, total: usize, groups: &[&[usize]]) -> Vec<Option<usize>> {
    let mut w = vec![total / count; count];
    let mut extra = total % count;
    for g in groups {
        if extra >= g.len() {
            g.iter().for_each(|&i| w[i] += 1);
            extra -= g.len();
        }
    }
    let mut out = vec![None; (n - (total - extra)) / 2];
    for (i, &k) in w.iter().enumerate() {
        out.extend(std::iter::repeat(Some(i)).take(k));
    }
    out.resize(n, None);
    out
}

/// The kraken's columns and rows at `n` px. A margin of a sixteenth, at least a pixel, so at
/// 16, 32, 48 … px every cell is square.
fn grid(n: usize) -> (Vec<Option<usize>>, Vec<Option<usize>>) {
    let w = (n - 2 * (n / 16).max(1)) & !1;
    let h = (w * 12 + 7) / 14;
    (spans(n, 14, w, &COLS), spans(n, 12, h, &ROWS))
}

/// The logo at `n`×`n` pixels (16 or more) as straight-alpha BGRA, rows from the top. `grey`
/// drains the colour; `dot` puts a red dot in the bottom right corner.
pub fn draw(n: usize, grey: bool, dot: bool) -> Vec<[u8; 4]> {
    const SS: usize = 4;
    let (cols, rows) = grid(n);
    let mut out = vec![[0; 4]; n * n];
    for (i, px) in out.iter_mut().enumerate() {
        let (x, y) = (i % n, i / n);
        let kraken = rows[y].zip(cols[x]).and_then(|(r, c)| paint(KRAKEN[r].as_bytes()[c]));
        let mut base = kraken.unwrap_or_else(|| {
            let t = (y as f32 + 0.5) / n as f32;
            [0, 1, 2].map(|k| (TOP[k] as f32 + (BOTTOM[k] as f32 - TOP[k] as f32) * t).round() as u8)
        });
        if grey {
            let l = ((base[0] as u32 * 299 + base[1] as u32 * 587 + base[2] as u32 * 114) / 1000) as u8;
            base = [l; 3];
        }
        let (mut sum, mut hits) = ([0u32; 3], 0u32);
        for s in 0..SS * SS {
            // the sample, in 64ths of the tile
            let u = (x as f32 + ((s % SS) as f32 + 0.5) / SS as f32) * 64.0 / n as f32;
            let v = (y as f32 + ((s / SS) as f32 + 0.5) / SS as f32) * 64.0 / n as f32;
            if let Some(c) = sample(u, v, base, dot) {
                for k in 0..3 {
                    sum[k] += c[k] as u32;
                }
                hits += 1;
            }
        }
        if hits > 0 {
            let c = sum.map(|s| (s / hits) as u8);
            *px = [c[2], c[1], c[0], (hits * 255 / (SS * SS) as u32) as u8];
        }
    }
    out
}

/// The colour at a point of the 64-unit tile, or None where it is transparent.
fn sample(u: f32, v: f32, base: [u8; 3], dot: bool) -> Option<[u8; 3]> {
    if dot {
        let d = (u - 51.0).hypot(v - 51.0);
        if d <= 12.0 {
            return Some(RED);
        }
        if d <= 16.0 {
            return None; // a gap between the dot and the tile
        }
    }
    const R: f32 = 14.0;
    let inside = (0.0..=64.0).contains(&u) && (0.0..=64.0).contains(&v);
    (inside && (u - u.clamp(R, 64.0 - R)).hypot(v - v.clamp(R, 64.0 - R)) <= R).then_some(base)
}

/// An icon image as Windows keeps it, in an .ico file or a resource: a BITMAPINFOHEADER, the
/// pixels from the bottom up, and the AND mask, which marks the transparent ones for whatever
/// ignores the alpha.
pub fn dib(n: usize, px: &[[u8; 4]]) -> Vec<u8> {
    let mask_row = n.div_ceil(32) * 4;
    let mut out = Vec::with_capacity(40 + n * n * 4 + mask_row * n);
    // its height counts the colour rows and the mask rows
    for x in [40, n as u32, 2 * n as u32] {
        out.extend(x.to_le_bytes());
    }
    out.extend([1, 0, 32, 0]); // one plane, 32 bits per pixel
    out.extend([0; 24]); // uncompressed; the rest is unused
    for row in px.chunks(n).rev() {
        out.extend(row.iter().flatten());
    }
    for row in px.chunks(n).rev() {
        let mut bits = vec![0u8; mask_row];
        for (x, p) in row.iter().enumerate() {
            if p[3] == 0 {
                bits[x / 8] |= 0x80 >> (x % 8);
            }
        }
        out.extend(bits);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// assets/icon.svg: the 16 px drawing, in 16 units, crisp at any multiple.
    fn svg() -> String {
        let mut paths = String::new();
        for (c, colour) in [(b'X', "#60a5fa"), (b'o', "#bfdbfe"), (b'W', "#f7faff"), (b'K', "#0b1a2e")] {
            let mut d = String::new();
            for (y, row) in KRAKEN.iter().enumerate() {
                let row = row.as_bytes();
                let mut x = 0;
                while x < row.len() {
                    let len = row[x..].iter().take_while(|&&b| b == c).count();
                    if len > 0 {
                        d += &format!("M{} {}h{len}v1h-{len}z", x + 1, y + 2);
                    }
                    x += len.max(1);
                }
            }
            paths += &format!("    <path fill=\"{colour}\" d=\"{d}\"/>\n");
        }
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">\n  \
             <linearGradient id=\"tile\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#14264a\"/><stop offset=\"1\" stop-color=\"#0a1426\"/></linearGradient>\n  \
             <rect width=\"16\" height=\"16\" rx=\"3.5\" fill=\"url(#tile)\"/>\n  \
             <g shape-rendering=\"crispEdges\">\n{paths}  </g>\n</svg>\n"
        )
    }

    /// Rewrites assets/icon.svg after a change to the kraken: `cargo test logo -- --ignored`
    #[test]
    #[ignore]
    fn write_svg() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/icon.svg"), svg()).unwrap();
    }

    #[test]
    fn svg_is_the_same_drawing() {
        let file = include_str!("../assets/icon.svg").replace("\r\n", "\n");
        assert_eq!(file, svg(), "assets/icon.svg is out of date: cargo test logo -- --ignored");
    }

    #[test]
    fn kraken_is_symmetric_and_inside_the_tile_at_every_size() {
        for n in (16..=64).step_by(2).chain([96, 128, 256]) {
            let (cols, rows) = grid(n);
            let at = |x: usize, y: usize| rows[y].zip(cols[x]).map(|(r, c)| KRAKEN[r].as_bytes()[c]).filter(|&c| c != b'.');
            let (mut white, mut lit) = ([0; 2], 0);
            for y in 0..n {
                for x in 0..n {
                    let c = at(x, y);
                    // pupils and highlights aside, the shape mirrors
                    assert_eq!(c.is_some(), at(n - 1 - x, y).is_some(), "{n} px: ({x}, {y}) mirrors");
                    if c.is_some() {
                        assert!(x > 0 && y > 0 && x < n - 1 && y < n - 1, "{n} px: ({x}, {y}) is inside the margin");
                        lit += 1;
                    }
                    if c == Some(b'W') {
                        white[(x >= n / 2) as usize] += 1;
                    }
                }
            }
            assert!(white[0] > 0 && white[0] == white[1], "{n} px: both eyes alike, {white:?}");
            // about as much of the tile as at 16 px, where it is 120 of 256 pixels
            let share = lit as f32 / (n * n) as f32;
            assert!((0.4..0.6).contains(&share), "{n} px: the kraken fills {share}");
        }
        // at multiples of 16 every cell is square
        let (cols, _) = grid(48);
        assert_eq!(cols.iter().filter(|&&c| c == Some(0)).count(), 3);
    }

    #[test]
    fn tile_corners_grey_and_the_red_dot() {
        let px = draw(32, false, false);
        assert_eq!(px[0][3], 0, "rounded corner");
        assert_eq!(px[16][3], 255, "tile");
        // the eye white of the left eye, at 2 px a cell: column 3, row 4
        assert_eq!(px[(4 + 2 * 4) * 32 + 2 + 2 * 3], [0xff, 0xfa, 0xf7, 255]);
        let grey = draw(32, true, false);
        let p = grey[(4 + 2 * 4) * 32 + 2 + 2 * 3];
        assert!(p[0] == p[1] && p[1] == p[2], "grey: {p:?}");
        let failing = draw(32, false, true);
        assert_eq!(failing[25 * 32 + 25], [0x26, 0x26, 0xdc, 255], "red dot");
        assert_eq!(failing[20 * 32 + 20][3], 0, "the gap around it");
    }

    #[test]
    fn dib_masks_what_is_transparent() {
        let px = draw(16, false, false);
        let d = dib(16, &px);
        assert_eq!(d.len(), 40 + 16 * 16 * 4 + 4 * 16);
        assert_eq!(&d[4..12], &[16, 0, 0, 0, 32, 0, 0, 0]);
        // the first mask row is the bottom one: its corners are transparent, its middle the tile
        let mask = &d[40 + 16 * 16 * 4..];
        assert_eq!(mask[0] & 0x80, 0x80);
        assert_eq!(mask[0] & 0x01, 0);
    }
}
