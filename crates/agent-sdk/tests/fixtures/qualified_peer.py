"""Disposable stdlib-only peer. Never reads profiles, credentials or native state."""
import base64
import hashlib
import json
import os
import socket
import struct
import sys


def response(value):
    if value.get("method") == "hang":
        return None
    if value.get("method") == "native-error":
        return {"id": value["id"], "error": {"message": "private fake provider data"}}
    return {"id": value.get("id"), "result": value.get("params")}


def exact(conn, count):
    data = b""
    while len(data) < count:
        chunk = conn.recv(count - len(data))
        if not chunk:
            raise EOFError()
        data += chunk
    return data


def frame(conn, data, opcode=1):
    prefix = bytes([0x80 | opcode])
    if len(data) < 126:
        prefix += bytes([len(data)])
    elif len(data) < 65536:
        prefix += bytes([126]) + struct.pack("!H", len(data))
    else:
        prefix += bytes([127]) + struct.pack("!Q", len(data))
    conn.sendall(prefix + data)


def unix_host(path):
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(path)
    listener.listen(4)
    print("ready", flush=True)
    while True:
        conn, _ = listener.accept()
        try:
            header = b""
            while not header.endswith(b"\r\n\r\n"):
                header += exact(conn, 1)
            key = next(x.split(b":", 1)[1].strip() for x in header.split(b"\r\n")
                       if x.lower().startswith(b"sec-websocket-key:"))
            accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
            while True:
                first, second = exact(conn, 2)
                length = second & 127
                if length == 126:
                    length = struct.unpack("!H", exact(conn, 2))[0]
                elif length == 127:
                    length = struct.unpack("!Q", exact(conn, 8))[0]
                mask = exact(conn, 4) if second & 128 else b"\0" * 4
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(exact(conn, length)))
                if first & 15 == 8:
                    break
                if first & 15 == 9:
                    frame(conn, data, 10)
                    continue
                result = response(json.loads(data))
                if result is not None:
                    frame(conn, json.dumps(result).encode())
        except (EOFError, ConnectionError, OSError):
            pass
        finally:
            conn.close()


if sys.argv[1] == "unix":
    unix_host(sys.argv[2])
elif sys.argv[1] == "partial":
    print(json.dumps({"method": "ready", "params": {"pid": os.getpid()}}), flush=True)
    # Read the pipe directly so the prefix boundary does not depend on Python's
    # stdin buffering. Short reads must not end the prefix early.
    data = b""
    while len(data) < 4096:
        chunk = os.read(sys.stdin.fileno(), 4096 - len(data))
        if not chunk:
            break
        data += chunk
    with open(sys.argv[2], "w", encoding="ascii") as out:
        out.write(str(len(data)))
else:
    print(json.dumps({"method": "ready", "params": {"pid": os.getpid()}}), flush=True)
    for line in sys.stdin:
        value = json.loads(line)
        if value.get("method") == "exit":
            break
        result = response(value)
        if result is not None:
            print(json.dumps(result), flush=True)
