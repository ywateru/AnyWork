#!/usr/bin/env python3
"""Exercise the per-ABI APK boundary without a device or signing material."""
import importlib.util
import io
from pathlib import Path
import struct
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('apk_checker', Path(__file__).with_name('check-android-apk.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def elf(abi, alignment=16384):
    bits, machine = checker.ABI_ELF[abi]
    data = bytearray(128)
    data[:6] = b'\x7fELF' + bytes([bits, 1])
    struct.pack_into('<H', data, 18, machine)
    if bits == 2:
        struct.pack_into('<Q', data, 32, 64)
        struct.pack_into('<HH', data, 54, 56, 1)
        struct.pack_into('<I', data, 64, 1)
        struct.pack_into('<Q', data, 112, alignment)
    else:
        struct.pack_into('<I', data, 28, 52)
        struct.pack_into('<HH', data, 42, 32, 1)
        struct.pack_into('<I', data, 52, 1)
        struct.pack_into('<I', data, 80, alignment)
    return data


class NativeLayoutTests(unittest.TestCase):
    def check(self, entries, abi):
        buffer = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)  # Deliberate duplicate ZIP fixture.
            with zipfile.ZipFile(buffer, 'w') as archive:
                for name, data in entries:
                    archive.writestr(name, data)
        buffer.seek(0)
        with zipfile.ZipFile(buffer) as archive:
            return checker.check_native_layout(archive, abi)

    def test_accepts_each_single_abi(self):
        for abi in checker.ABI_ELF:
            with self.subTest(abi=abi):
                self.assertEqual(len(self.check([(f'lib/{abi}/libanywork_mobile.so', elf(abi))], abi)), 1)

    def test_rejects_missing_mobile_library(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.check([], 'x86')

    def test_rejects_wrong_abi(self):
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.check([('lib/x86_64/libanywork_mobile.so', elf('x86_64'))], 'x86')

    def test_rejects_multi_abi_apk(self):
        with self.assertRaisesRegex(ValueError, 'only the requested ABI'):
            self.check([(f'lib/{abi}/libanywork_mobile.so', elf(abi)) for abi in checker.ABI_ELF], 'x86')

    def test_rejects_foreign_dependency_library(self):
        with self.assertRaisesRegex(ValueError, 'only the requested ABI'):
            self.check([('lib/x86/libanywork_mobile.so', elf('x86')),
                        ('lib/x86_64/libother.so', elf('x86_64'))], 'x86')

    def test_rejects_duplicate_mobile_library(self):
        entry = ('lib/x86/libanywork_mobile.so', elf('x86'))
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            self.check([entry, entry], 'x86')

    def test_rejects_mislabeled_elf(self):
        with self.assertRaisesRegex(ValueError, 'architecture'):
            self.check([('lib/x86/libanywork_mobile.so', elf('armeabi-v7a'))], 'x86')

    def test_rejects_4k_elf(self):
        with self.assertRaisesRegex(ValueError, '16 KiB'):
            self.check([('lib/x86/libanywork_mobile.so', elf('x86', 4096))], 'x86')


if __name__ == '__main__':
    unittest.main()
