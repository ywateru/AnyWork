#!/usr/bin/env python3
"""No network: state/GO/deployment/rollback recovery and exact secret boundaries."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('redis_cutover', Path(__file__).with_name('redis-cutover.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Cutover(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.op = self.root / ('redis-selfhost-' + str(uuid.uuid4()))
        self.op.mkdir(mode=0o700)
        self.redis = {'schema':1,'transport':'tls-tcp','host':'redis.x.aixgg.com','port':6379,
                      'username':'redis_2429e58a','password':'fixture-only-secret!','namespace':m.PREFIX}
        m.cloud.save_private(self.op/'redis-input.private.json',self.redis)
        m.cloud.save_private(self.op/'node-readonly-proof.private.json',dict(schema=1,tls=True,hostnameVerified=True,
            authenticated=True,ping=True,wrongHostnameRejected=True,untrustedIssuerRejected=True,
            types=dict(meta='none',initialized='none',revision='none',sequence='none')))
        old_env={key:'fixture-'+key for key in m.BASE|m.OLD}
        self.rows={k:{'id':'env_'+str(n),'value':v} for n,(k,v) in enumerate(sorted(old_env.items()))}
        identity=m.deploy.configuration_identity(m.PROJECT,m.NAME,m.SOURCE,old_env)
        self.artifact=dict(sourceKind='prebuilt',upstreamSource=m.deploy.PIN,patchHash='a'*64,outputHash=m.ARTIFACT)
        identity.update(self.artifact)
        self.old_intent=dict(schema=1,operationId=str(uuid.uuid4()),phase='observed',deploymentId='dpl_old',status='READY',identity=identity)
        self.old=dict(gridDeploymentIntent=self.old_intent,gridEnvironment=old_env)
        self.baseline=self.root/'baseline.json';m.cloud.save_private(self.baseline,self.old);self.baseline_bytes=self.baseline.read_bytes()
        self.upload=self.root/'original-upload';self.upload.mkdir();(self.upload/'.vercel').mkdir()
        (self.upload/'.vercel/config').write_text('artifact-only')
        self.provenance=self.root/'provenance.json';self.provenance.write_text('{}')
        self.cli=self.root/'tools/node_modules/vercel/dist/index.js';self.cli.parent.mkdir(parents=True);self.cli.write_text('fixture CLI')
        self.alias='dpl_old';self.calls=[];self.deployments={}
        self.old_detail=dict(id='dpl_old',projectId=m.PROJECT,readyState='READY',target='production',meta=m.deploy.metadata(self.old_intent))
        self.p1=patch.object(m.deploy,'prebuilt_identity',return_value=self.artifact);self.p1.start();self.addCleanup(self.p1.stop)
        self.p3=patch.object(m,'initialize_namespace',return_value='c'*64);self.p3.start();self.addCleanup(self.p3.stop)
        self.p2=patch.object(m.deploy.subprocess,'run',return_value=type('R',(),{'returncode':0,'stdout':'50.28.0\n'})());self.p2.start();self.addCleanup(self.p2.stop)

    def vercel(self,route,method='GET',data=None):
        self.calls.append((method,route,copy.deepcopy(data)))
        if route.startswith('/v4/aliases/'):
            if method=='GET':return {'projectId':m.PROJECT,'deployment':{'id':self.alias}}
        if route=='/v13/deployments/dpl_old':return self.old_detail
        if route.startswith('/v13/deployments/'):
            return self.deployments[route.split('/')[-1]]
        if route.startswith('/v6/deployments?'):return {'deployments':list(self.deployments.values()),'pagination':{'next':None}}
        if route=='/v9/projects/'+m.PROJECT+'/env':
            return {'envs':[dict(key=k,id=r['id'],target=['production'],type='encrypted') for k,r in self.rows.items()]}
        if route.startswith('/v1/projects/'+m.PROJECT+'/env/'):
            key,row=next((k,r) for k,r in self.rows.items() if r['id']==route.split('/')[-1]);return dict(key=key,value=row['value'],decrypted=True)
        if method=='POST' and route.endswith('/env?upsert=true'):
            for row in data:
                self.rows[row['key']]={'id':self.rows.get(row['key'],{}).get('id','env_'+row['key']),'value':row['value']}
            return {}
        if method=='DELETE' and '/env/' in route:
            key=next(k for k,r in self.rows.items() if r['id']==route.split('/')[-1]);del self.rows[key];return {}
        if method=='POST' and route=='/v2/deployments/dpl_old/aliases':self.alias='dpl_old';return {}
        raise AssertionError('Unexpected synthetic provider route')

    def prepare(self):
        self.c=m.prepare(self.op,self.baseline,self.upload,self.provenance,self.cli,self.vercel)
        self.state=m.cloud.private_json(self.op/'operation.private.json')
        return self.c

    def go(self,action='apply',**extra):
        value=dict(action=action,operationId=self.c['operationId'],candidateHash=self.state['candidateHash'],helperHashes=m.helpers(),
            expiresAt=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())
        value.update(extra);p=self.op/(action+'-go.private.json');m.cloud.save_private(p,value);return p

    def submit(self,directory,cli,intent):
        disk=m.cloud.private_json(self.op/'operation.private.json');self.assertEqual(disk['phase'],'submitting')
        self.assertEqual(m.values(self.rows),self.c['desiredEnvironment'])
        row=dict(id='dpl_new',uid='dpl_new',projectId=m.PROJECT,target='production',readyState='READY',meta=m.deploy.metadata(intent))
        self.deployments['dpl_new']=row;self.alias='dpl_new'

    def test_prepare_only_reads_and_pins_secret_free_artifact(self):
        self.prepare();self.assertTrue(all(x[0]=='GET' for x in self.calls))
        self.assertEqual(set(self.c['desiredEnvironment']),m.BASE|m.NEW)
        self.assertEqual(self.c['desiredEnvironment']['CYBERGRID_REDIS_TRANSPORT'],'tcp')
        self.assertIn('fixture-only-secret%21@redis.x.aixgg.com:6379',self.c['desiredEnvironment']['REDIS_URL'])
        self.assertEqual(m.binding(self.op,self.state),self.c)
        self.assertEqual(self.baseline.read_bytes(),self.baseline_bytes)
        self.assertNotIn(self.redis['password'],str(list((self.op/'upload').rglob('*'))))

    def test_live_baseline_or_environment_drift_stops_before_any_write(self):
        self.alias='dpl_other'
        with self.assertRaises(m.cloud.ConfigurationError):self.prepare()
        self.assertTrue(all(x[0]=='GET' for x in self.calls))

    def test_certificate_domain_tls_and_credentials_are_fixed(self):
        for key,value in [('host','1.2.3.4'),('port',6380),('transport','tcp'),('username','other'),('namespace','unrelated'),('password','')]:
            bad={**self.redis,key:value}
            with self.subTest(key=key),self.assertRaises(m.cloud.ConfigurationError):m.redis_environment(bad)

    def test_readonly_proof_is_required(self):
        m.cloud.save_private(self.op/'node-readonly-proof.private.json',{'tls':False})
        with self.assertRaises(m.cloud.ConfigurationError):self.prepare()
        self.assertTrue(all(x[0]=='GET' for x in self.calls))

    def test_apply_go_exact_hash_and_fresh_expiry(self):
        self.prepare()
        for value in [dict(candidateHash='b'*64),dict(expiresAt=datetime.now(timezone.utc).isoformat()),dict(action='rollback'),dict(helperHashes={})]:
            with self.subTest(value=value),self.assertRaises(m.cloud.ConfigurationError):m.apply(self.op,self.state,self.c,self.go(**value),self.vercel)
        self.assertTrue(all(x[0]=='GET' for x in self.calls))

    def test_apply_once_durable_intent_and_old_rest_removed(self):
        self.prepare()
        with patch.object(m.deploy,'submit_prebuilt',side_effect=self.submit) as submit:
            result=m.apply(self.op,self.state,self.c,self.go(),self.vercel)
            self.assertEqual(result['phase'],'ready');self.assertEqual(result['aliasDeploymentId'],'dpl_new')
            with self.assertRaises(m.cloud.ConfigurationError):m.apply(self.op,self.state,self.c,self.go(),self.vercel)
            self.assertEqual(submit.call_count,1)
        self.assertEqual(set(self.rows),m.BASE|m.NEW)

    def test_unknown_cli_outcome_only_observes_never_replays(self):
        self.prepare()
        def lost(*args):self.submit(*args);raise m.cloud.ConfigurationError('synthetic lost outcome')
        with patch.object(m.deploy,'submit_prebuilt',side_effect=lost) as submit:
            with self.assertRaises(m.cloud.ConfigurationError):m.apply(self.op,self.state,self.c,self.go(),self.vercel)
            state=m.cloud.private_json(self.op/'operation.private.json');self.assertEqual(state['phase'],'submitting')
            result=m.inspect(self.op,state,m.binding(self.op,state),self.vercel)
            self.assertEqual(result['phase'],'ready');self.assertEqual(submit.call_count,1)

    def test_tamper_candidate_input_helper_or_upload_fails_binding(self):
        self.prepare()
        p=self.op/'redis-input.private.json';raw=p.read_bytes();p.write_bytes(raw+b' ')
        with self.assertRaises(m.cloud.ConfigurationError):m.binding(self.op,self.state)
        p.write_bytes(raw)
        self.c['helperHashes']={};m.cloud.save_private(self.op/'candidate.private.json',self.c)
        with self.assertRaises(m.cloud.ConfigurationError):m.binding(self.op,self.state)

    def test_rollback_restores_old_environment_and_alias_with_fresh_go(self):
        self.prepare()
        with patch.object(m.deploy,'submit_prebuilt',side_effect=self.submit):m.apply(self.op,self.state,self.c,self.go(),self.vercel)
        result=m.rollback(self.op,self.state,self.c,self.go('rollback'),self.vercel)
        self.assertEqual(result['phase'],'rolled-back');self.assertEqual(m.values(self.rows),self.old['gridEnvironment']);self.assertEqual(self.alias,'dpl_old')
        with self.assertRaises(m.cloud.ConfigurationError):m.rollback(self.op,self.state,self.c,self.go('rollback'),self.vercel)

    def test_rollback_cannot_override_other_actor_environment(self):
        self.prepare()
        with patch.object(m.deploy,'submit_prebuilt',side_effect=self.submit):m.apply(self.op,self.state,self.c,self.go(),self.vercel)
        self.rows['LOGTO_ISSUER']['value']='unrelated-change'
        before=len(self.calls)
        with self.assertRaises(m.cloud.ConfigurationError):m.rollback(self.op,self.state,self.c,self.go('rollback'),self.vercel)
        self.assertTrue(all(x[0]=='GET' for x in self.calls[before:]))

    def test_rollback_unknown_completion_is_readonly_reconciled(self):
        self.prepare();self.state['phase']='rollback-submitting'
        result=m.inspect(self.op,self.state,self.c,self.vercel)
        self.assertEqual(result['phase'],'rolled-back');self.assertTrue(all(x[0]=='GET' for x in self.calls))

    def test_namespace_initialization_failure_prevents_all_vercel_writes(self):
        self.prepare()
        before=len(self.calls)
        with patch.object(m,'initialize_namespace',side_effect=m.cloud.ConfigurationError('fixture permission denied')):
            with self.assertRaises(m.cloud.ConfigurationError):m.apply(self.op,self.state,self.c,self.go(),self.vercel)
        self.assertEqual(m.cloud.private_json(self.op/'operation.private.json')['phase'],'namespace-initializing')
        self.assertTrue(all(x[0]=='GET' for x in self.calls[before:]))

    def test_cli_dependency_tampering_fails_exact_binding(self):
        self.prepare()
        (self.cli.parents[2]/'dependency.js').write_text('tampered')
        with self.assertRaises(m.cloud.ConfigurationError):m.binding(self.op,self.state)

    def test_checkpoint_failure_blocks_environment_and_cli(self):
        self.prepare();before=len(self.calls);go=self.go()
        with patch.object(m.cloud,'save_private',side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):m.apply(self.op,self.state,self.c,go,self.vercel)
        self.assertTrue(all(x[0]=='GET' for x in self.calls[before:]))

if __name__=='__main__':unittest.main()
