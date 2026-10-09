"""Get current user."""

from typing import Any

from flask import g

from spiffworkflow_backend.models.script_attributes_context import ScriptAttributesContext
from spiffworkflow_backend.scripts.get_process_initiator_user import GetProcessInitiatorUser
from spiffworkflow_backend.scripts.script import Script


class GetCurrentUser(Script):
    @staticmethod
    def requires_privileged_permissions() -> bool:
        """We have deemed this function safe to run without elevated permissions."""
        return False

    def get_description(self) -> str:
        return """Return the current user, or the process initiator when running in the background."""

    def run(self, script_attributes_context: ScriptAttributesContext, *_args: Any, **kwargs: Any) -> Any:
        # background runs (celery/apscheduler) have no request, so g.user is missing or None.
        # fall back to the initiator, the same user privileged-script checks use (see Script.check_script_permission).
        if g.get("user") is None:
            return GetProcessInitiatorUser().run(script_attributes_context)
        # dump the user using our json encoder and then load it back up as a dict
        # to remove unwanted field types
        return g.user.as_dict()
