// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
//! Draws the logo of src/logo.rs at the sizes Windows picks from and links it into the exe as
//! its icon, and writes the pages' favicon, OUT_DIR/favicon.ico. The resource file is written
//! here too, so the build needs no resource compiler.

#[path = "src/logo.rs"]
mod logo;

use std::io::Write;
use std::path::PathBuf;

/// What Explorer, the Start menu and the taskbar ask for from 100 % to 300 % scale. They
/// shrink 256 to the multiples of 16 in between, which stay sharp.
const SIZES: [usize; 8] = [16, 20, 24, 32, 40, 48, 64, 256];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/logo.rs");
    let images: Vec<(usize, Vec<u8>)> = SIZES
        .iter()
        .map(|&n| {
            let px = logo::draw(n, false, false);
            // as Windows expects: PNG at 256, a DIB below
            (n, if n == 256 { png(n, &px) } else { logo::dib(n, &px) })
        })
        .collect();
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    // a browser tab wants 16 or 32 px, a shortcut to the page 48
    let tab: Vec<_> = images.iter().filter(|(n, _)| [16, 32, 48].contains(n)).cloned().collect();
    std::fs::write(out.join("favicon.ico"), ico(&tab)).unwrap();
    let target = |key: &str| std::env::var(key).unwrap_or_default();
    // link.exe takes a .res as it is; the GNU linker would need windres
    if target("CARGO_CFG_TARGET_OS") == "windows" && target("CARGO_CFG_TARGET_ENV") == "msvc" {
        let path = out.join("krakendial.res");
        std::fs::write(&path, res(&images)).unwrap();
        println!("cargo:rustc-link-arg-bins={}", path.display());
    }
}

/// The part of a directory entry that an .ico file and an icon group share.
fn entry(n: usize, len: usize) -> Vec<u8> {
    // 0 stands for 256
    let mut e = vec![n as u8, n as u8, 0, 0, 1, 0, 32, 0];
    e.extend((len as u32).to_le_bytes());
    e
}

fn ico(images: &[(usize, Vec<u8>)]) -> Vec<u8> {
    let mut out = vec![0, 0, 1, 0];
    out.extend((images.len() as u16).to_le_bytes());
    let mut at = 6 + 16 * images.len();
    for (n, data) in images {
        out.extend(entry(*n, data.len()));
        out.extend((at as u32).to_le_bytes());
        at += data.len();
    }
    for (_, data) in images {
        out.extend(data);
    }
    out
}

/// A compiled resource file: an icon per size and the group that lists them, as icon 1.
fn res(images: &[(usize, Vec<u8>)]) -> Vec<u8> {
    fn resource(out: &mut Vec<u8>, kind: u16, id: u16, flags: u16, data: &[u8]) {
        out.extend((data.len() as u32).to_le_bytes());
        out.extend(32u32.to_le_bytes()); // the header's size
        for x in [0xffff, kind, 0xffff, id] {
            out.extend(x.to_le_bytes());
        }
        out.extend(0u32.to_le_bytes()); // data version
        out.extend(flags.to_le_bytes());
        out.extend(0u16.to_le_bytes()); // language neutral
        out.extend([0; 8]); // version and characteristics
        out.extend(data);
        out.resize(out.len().next_multiple_of(4), 0);
    }
    const RT_ICON: u16 = 3;
    const RT_GROUP_ICON: u16 = 14;
    // moveable and discardable, as rc.exe marks icons; Windows ignores it
    const FLAGS: u16 = 0x1010;
    let mut out = Vec::new();
    // every .res file starts with an empty entry
    resource(&mut out, 0, 0, 0, &[]);
    let mut group = vec![0, 0, 1, 0];
    group.extend((images.len() as u16).to_le_bytes());
    for (i, (n, data)) in images.iter().enumerate() {
        let id = i as u16 + 1;
        resource(&mut out, RT_ICON, id, FLAGS, data);
        group.extend(entry(*n, data.len()));
        group.extend(id.to_le_bytes());
    }
    resource(&mut out, RT_GROUP_ICON, 1, FLAGS | 0x20, &group);
    out
}

/// A PNG of straight-alpha BGRA pixels.
fn png(n: usize, px: &[[u8; 4]]) -> Vec<u8> {
    let mut raw = Vec::with_capacity(n * (4 * n + 1));
    for row in px.chunks(n) {
        raw.push(0); // no filter: the rows repeat, which deflate finds anyway
        raw.extend(row.iter().flat_map(|p| [p[2], p[1], p[0], p[3]]));
    }
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    z.write_all(&raw).unwrap();
    let mut header = Vec::new();
    header.extend((n as u32).to_be_bytes());
    header.extend((n as u32).to_be_bytes());
    header.extend([8, 6, 0, 0, 0]); // 8 bits a channel, RGBA
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    for (kind, data) in [(b"IHDR", header), (b"IDAT", z.finish().unwrap()), (b"IEND", Vec::new())] {
        out.extend((data.len() as u32).to_be_bytes());
        let mut crc = flate2::Crc::new();
        crc.update(kind);
        crc.update(&data);
        out.extend(kind);
        out.extend(data);
        out.extend(crc.sum().to_be_bytes());
    }
    out
}
