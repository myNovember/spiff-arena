import pytest
from flask import g
from flask.app import Flask

from spiffworkflow_backend.background_processing.process_instance_operations import run_queued_process_instance
from spiffworkflow_backend.models.process_instance import ProcessInstanceModel
from spiffworkflow_backend.models.process_instance import ProcessInstanceStatus
from spiffworkflow_backend.services.process_instance_runtime import ProcessInstanceRuntime
from tests.spiffworkflow_backend.helpers.base_test import BaseTest
from tests.spiffworkflow_backend.helpers.test_data import load_test_spec


class TestGetCurrentUserInBackground(BaseTest):
    """Background runs (celery/apscheduler) execute the engine without a request, so g.user is never set.

    get_current_user() must fall back to the process initiator there instead of crashing.
    sequential -> single engine step path (g.user absent); parallel -> multi-step path (g.user set to None).
    """

    @pytest.mark.parametrize("bpmn_file_name", ["sequential.bpmn", "parallel.bpmn"])
    @pytest.mark.parametrize("with_request_user", [True, False], ids=["request_user", "background_no_g_user"])
    def test_get_current_user_in_background_run(
        self,
        app: Flask,
        with_db_and_bpmn_file_cleanup: None,
        bpmn_file_name: str,
        with_request_user: bool,
    ) -> None:
        process_model = load_test_spec(
            process_model_id=f"test_group/get_current_user_{bpmn_file_name.removesuffix('.bpmn')}",
            bpmn_file_name=bpmn_file_name,
            process_model_source_directory="get_current_user_in_background",
        )
        initiator = self.find_or_create_user("initiator")
        request_user = self.find_or_create_user("request_user")
        process_instance = self.create_process_instance_from_process_model(process_model, user=initiator)

        # background worker: no authenticated request, so nothing set g.user. otherwise: as if omni_auth had run
        g.pop("user", None)
        if with_request_user:
            g.user = request_user

        result = run_queued_process_instance(process_instance.id)

        process_instance = ProcessInstanceModel.query.filter_by(id=process_instance.id).one()
        assert result.outcome.value == "success", result.result()
        assert process_instance.status == ProcessInstanceStatus.complete.value

        expected_username = "request_user" if with_request_user else "initiator"
        data = ProcessInstanceRuntime(process_instance).get_data()
        usernames = [data[key] for key in ("current_username", "username_a", "username_b") if key in data]
        assert usernames, data
        assert set(usernames) == {expected_username}
