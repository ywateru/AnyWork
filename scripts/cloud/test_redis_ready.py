#!/usr/bin/env python3
"""Run the mutating-stage wrapper only against a network-free fake Store module."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

class ReadyWrapper(unittest.TestCase):
    def test_ready_success_and_denial_never_emit_private_material(self):
        for denied in [False,True]:
            with self.subTest(denied=denied),tempfile.TemporaryDirectory() as root:
                root=Path(root)
                input=root/'input.json'
                input.write_text(json.dumps(dict(schema=1,transport='tls-tcp',host='redis.x.aixgg.com',port=6379,
                    username='redis_2429e58a',password='synthetic-private-value',namespace='anywork:selfhost:v1')))
                input.chmod(0o600)
                module=root/'store.mjs'
                module.write_text("import fs from 'node:fs';export function redisTransport(env){if(!env.REDIS_URL.startsWith('rediss://'))throw Error();return env;}export class RedisStore{constructor(t,p){this.epoch='d0afee55-7765-4cae-91e1-81c77780689a';this.limits={sessions:512};}async ready(){"+
                    ("throw Error('synthetic-private-value');" if denied else '')+
                    "}close(){fs.writeFileSync(new URL('./closed',import.meta.url),'closed');}}")
                output=root/'proof.json'
                result=subprocess.run(['node',str(Path(__file__).with_name('redis-ready.mjs')),str(input),str(module),str(output)],capture_output=True,text=True,timeout=15)
                self.assertEqual(result.returncode,1 if denied else 0)
                self.assertNotIn('synthetic-private-value',result.stdout+result.stderr)
                self.assertTrue((root/'closed').is_file())
                if denied:self.assertFalse(output.exists())
                else:
                    proof=json.loads(output.read_text());self.assertTrue(proof['ready']);self.assertNotIn('seed',proof)
                    self.assertEqual(output.stat().st_mode&0o777,0o600)

if __name__=='__main__':unittest.main()
