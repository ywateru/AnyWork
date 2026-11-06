#!/usr/bin/env python3
"""Create a PNG-backed macOS icon from the existing resized AnyWork assets."""
import pathlib, struct, sys
folder, output = map(pathlib.Path, sys.argv[1:])
entries = [(b'ic07', 'icon_128x128.png'), (b'ic08', 'icon_256x256.png'), (b'ic09', 'icon_512x512.png'), (b'ic10', 'icon_512x512@2x.png')]
chunks = []
for kind, name in entries:
    data = (folder/name).read_bytes()
    if not data.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Icon asset must be PNG')
    chunks.append(kind + struct.pack('>I', len(data)+8) + data)
payload = b''.join(chunks)
output.write_bytes(b'icns' + struct.pack('>I', len(payload)+8) + payload)
