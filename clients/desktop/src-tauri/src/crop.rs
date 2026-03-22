use image::{DynamicImage, GenericImageView};

pub fn auto_crop_black_borders(mut img: DynamicImage) -> DynamicImage {
    let (width, height) = img.dimensions();

    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0;
    let mut max_y = 0;

    let threshold = 5u8;

    // Try to get a reference to avoid cloning the image buffer.
    // PipeWire always passes RGBA8 natively so this avoids allocations.
    let rgba_fallback;
    let rgba = if let Some(rgba) = img.as_rgba8() {
        rgba
    } else {
        rgba_fallback = img.to_rgba8();
        &rgba_fallback
    };

    let raw = rgba.as_raw();

    // Iterate over raw bytes in chunks of 4 (R, G, B, A).
    // This is orders of magnitude faster than `get_pixel(x, y)` because it avoids bounds checking.
    for (i, pixel) in raw.chunks_exact(4).enumerate() {
        if pixel[3] > threshold
            && (pixel[0] > threshold || pixel[1] > threshold || pixel[2] > threshold)
        {
            let x = (i as u32) % width;
            let y = (i as u32) / width;

            if x < min_x {
                min_x = x;
            }
            if x > max_x {
                max_x = x;
            }
            if y < min_y {
                min_y = y;
            }
            if y > max_y {
                max_y = y;
            }
        }
    }

    if min_x > max_x || min_y > max_y {
        return img;
    }

    let crop_width = max_x - min_x + 1;
    let crop_height = max_y - min_y + 1;

    if crop_width == width && crop_height == height {
        return img;
    }

    img.crop(min_x, min_y, crop_width, crop_height)
}
