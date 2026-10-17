//! Minimal EMVCo / QRIS helpers: CRC16 and validation of an uploaded *static* QRIS payload.

/// CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as used by QRIS tag 63.
pub fn crc16(data: &str) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for b in data.bytes() {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
}

/// Splits a payload into top-level (tag, value) pairs. `None` if it is not well-formed TLV.
pub fn parse_tlv(s: &str) -> Option<Vec<(String, String)>> {
    if !s.is_ascii() {
        return None;
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < s.len() {
        if i + 4 > s.len() {
            return None;
        }
        let tag = &s[i..i + 2];
        let len_str = &s[i + 2..i + 4];
        if !tag.bytes().all(|c| c.is_ascii_digit()) || !len_str.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let len: usize = len_str.parse().ok()?;
        i += 4;
        if i + len > s.len() {
            return None;
        }
        out.push((tag.to_string(), s[i..i + len].to_string()));
        i += len;
    }
    Some(out)
}

#[derive(Debug, PartialEq, Eq)]
pub struct QrisInfo {
    pub merchant_name: String,
    pub city: String,
}

/// Checks that `payload` is a well-formed, CRC-valid **static** QRIS and returns merchant details.
pub fn validate_static(payload: &str) -> Result<QrisInfo, &'static str> {
    if payload.len() < 20 || payload.len() > 1024 {
        return Err("invalid_length");
    }
    let tlv = parse_tlv(payload).ok_or("malformed")?;
    if tlv.first().map(|(t, v)| (t.as_str(), v.as_str())) != Some(("00", "01")) {
        return Err("not_emv_qr");
    }
    let (last_tag, crc) = tlv.last().ok_or("malformed")?;
    if last_tag != "63" || crc.len() != 4 {
        return Err("missing_crc");
    }
    let body = &payload[..payload.len() - 4];
    if format!("{:04X}", crc16(body)) != crc.to_uppercase() {
        return Err("bad_crc");
    }
    match tlv.iter().find(|(t, _)| t == "01").map(|(_, v)| v.as_str()) {
        Some("11") => {}
        Some("12") => return Err("already_dynamic"),
        _ => return Err("unknown_initiation"),
    }
    let get = |tag: &str| {
        tlv.iter()
            .find(|(t, _)| t == tag)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    Ok(QrisInfo { merchant_name: get("59"), city: get("60") })
}

/// Test/helper: builds a payload from `(tag, value)` pairs and appends a valid CRC.
pub fn build_with_crc(fields: &[(&str, &str)]) -> String {
    let mut s = String::new();
    for (t, v) in fields {
        s.push_str(&format!("{t}{:02}{v}", v.len()));
    }
    s.push_str("6304");
    let crc = crc16(&s);
    s.push_str(&format!("{crc:04X}"));
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn static_fields() -> Vec<(&'static str, &'static str)> {
        vec![
            ("00", "01"),
            ("01", "11"),
            ("26", "0014ID.CO.QRIS.WWW0215ID1234567890123"),
            ("52", "5812"),
            ("53", "360"),
            ("58", "ID"),
            ("59", "WARUNG CONTOH"),
            ("60", "CIANJUR"),
            ("61", "43211"),
        ]
    }

    #[test]
    fn crc16_matches_the_standard_check_value() {
        // CRC-16/CCITT-FALSE of "123456789"
        assert_eq!(crc16("123456789"), 0x29B1);
    }

    #[test]
    fn accepts_a_valid_static_qris() {
        let p = build_with_crc(&static_fields());
        let info = validate_static(&p).unwrap();
        assert_eq!(info, QrisInfo { merchant_name: "WARUNG CONTOH".into(), city: "CIANJUR".into() });
    }

    #[test]
    fn rejects_bad_crc_dynamic_and_garbage() {
        let p = build_with_crc(&static_fields());
        let mut tampered = p.clone();
        tampered.replace_range(p.len() - 1.., if p.ends_with('0') { "1" } else { "0" });
        assert_eq!(validate_static(&tampered), Err("bad_crc"));

        let mut dynamic = static_fields();
        dynamic[1] = ("01", "12");
        assert_eq!(validate_static(&build_with_crc(&dynamic)), Err("already_dynamic"));

        assert_eq!(validate_static("hello world, not a qris!"), Err("malformed"));
        assert_eq!(validate_static("0002"), Err("invalid_length"));
        let no_crc = "00020101021126".to_string() + &"0".repeat(30);
        assert!(validate_static(&no_crc).is_err());
    }
}
