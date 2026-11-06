#!/usr/bin/env python3
"""Rasterize the project's existing geometric terminal mark; no external image dependencies."""
import math,pathlib,struct,zlib
root=pathlib.Path(__file__).resolve().parents[1]/'web/public'
segments=[(48,57,88,96),(88,96,48,135),(102,135,144,135)]
def distance(x,y,s):
    x1,y1,x2,y2=s;t=max(0,min(1,((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)))
    return math.hypot(x-x1-t*(x2-x1),y-y1-t*(y2-y1))
def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
for size in (192,512):
    rows=[]
    for y in range(size):
        row=bytearray([0])
        for x in range(size):
            d=min(distance((x+.5)*192/size,(y+.5)*192/size,s)for s in segments)
            coverage=max(0,min(1,(6.5-d)*size/192+.5))
            row.extend(round(a*(1-coverage)+b*coverage)for a,b in zip((182,239,118),(23,33,23)))
        rows.append(row)
    data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')
    (root/f'icon-{size}.png').write_bytes(data)
