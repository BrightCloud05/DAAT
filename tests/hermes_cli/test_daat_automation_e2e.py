"""DAAT's REST -> profile store -> real local script execution contract.

No model, account, scheduler daemon, or real user runtime is used.
"""
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import yaml


@pytest.mark.parametrize('provider', ['mock', 'custom'])
def test_automation_preserves_custom_endpoint_after_default_switch(tmp_path, monkeypatch, provider):
    from cron.jobs import create_job
    from cron.scheduler import _load_cron_job_config, _resolve_job_runtime
    from hermes_cli.runtime_provider import resolve_runtime_provider

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('DAAT_TEST_MODEL_KEY', 'isolated-test-key')
    config = {
        'model': {'provider': provider, 'default': 'mock-model', 'base_url': 'http://127.0.0.1:12345/v1'},
        'providers': {
            'mock': {'api': 'http://127.0.0.1:12345/v1', 'key_env': 'DAAT_TEST_MODEL_KEY', 'models': {'mock-model': {}}},
            'other': {'api': 'http://127.0.0.1:12346/v1', 'key_env': 'DAAT_TEST_MODEL_KEY', 'models': {'other-model': {}}},
        },
    }
    config_path = tmp_path / 'config.yaml'
    config_path.write_text(yaml.safe_dump(config))
    initial = resolve_runtime_provider()
    job = create_job(prompt='Use the saved connection', schedule='every 1h')
    config['model'] = {'provider': 'other', 'default': 'other-model'}
    config_path.write_text(yaml.safe_dump(config))

    runtime, model = _resolve_job_runtime(job, job['id'], _load_cron_job_config(job, job['id'], job['name']))
    assert runtime['base_url'] == initial['base_url']
    assert runtime['api_key'] == 'isolated-test-key'
    assert model == 'mock-model'


def test_automation_lifecycle_executes_in_its_profile(tmp_path, monkeypatch):
    from hermes_cli import profiles
    from hermes_cli.web_routers.cron import router

    root = tmp_path / '.daat'
    work = root / 'profiles' / 'work'
    for home in (root, work):
        (home / 'scripts').mkdir(parents=True)
        (home / 'config.yaml').write_text('cron:\n  scheduler: builtin\n', encoding='utf-8')
    monkeypatch.setenv('HERMES_HOME', str(root))
    monkeypatch.setattr(profiles, '_get_default_hermes_home', lambda: root)
    monkeypatch.setattr(profiles, '_get_profiles_root', lambda: root / 'profiles')
    script = work / 'scripts' / 'smoke.py'
    marker = work / 'completed.txt'
    script.write_text(f'from pathlib import Path\nPath({str(marker)!r}).write_text("executed")\nprint("DAAT automation smoke")\n')
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post('/api/cron/jobs?profile=work', json={
            'name': 'DAAT smoke', 'prompt': '', 'schedule': 'every 1h',
            'script': str(script), 'no_agent': True, 'deliver': 'local',
        })
        assert response.status_code == 200, response.text
        job = response.json()
        assert job['profile'] == 'work'
        endpoint = f"/api/cron/jobs/{job['id']}"
        assert client.get('/api/cron/jobs?profile=default').json() == []
        assert client.post(endpoint + '/pause?profile=work').json()['enabled'] is False
        assert client.post(endpoint + '/resume?profile=work').json()['enabled'] is True
        fired = client.post(endpoint + '/trigger?profile=work')
        assert fired.status_code == 200, fired.text
        assert marker.read_text() == 'executed', fired.text
        stored = json.loads((work / 'cron' / 'jobs.json').read_text())
        rows = stored['jobs'] if isinstance(stored, dict) else stored
        assert rows[0]['last_status'] == 'ok'
        assert client.delete(endpoint + '?profile=work').json()['ok'] is True
        assert client.get('/api/cron/jobs?profile=work').json() == []
        assert not (root / 'completed.txt').exists()
