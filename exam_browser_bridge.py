"""JSON boundary for running the shared exam rules in a browser Python runtime."""
import json
from urllib.parse import parse_qs, urlsplit

from exam import ExamError, ExamRooms


def dispatch(saved_state, path, payload):
    manager = ExamRooms()
    manager.rooms = json.loads(saved_state)
    url = urlsplit(path)
    parts = url.path.strip('/').split('/')
    try:
        if parts == ['api', 'exam', 'rooms'] and payload is not None:
            result = manager.create(payload)
        elif len(parts) in (4, 5) and parts[:3] == ['api', 'exam', 'rooms']:
            room_id = parts[3]
            if payload is not None and len(parts) == 4:
                result = manager.act(room_id, payload.get('token'), payload)
            else:
                token = parse_qs(url.query).get('token', [''])[0]
                if len(parts) == 4:
                    result = manager.view(room_id, token)
                elif parts[4] == 'materials':
                    result = manager.materials(room_id, token)
                else:
                    raise ExamError('找不到这个考场接口。')
        else:
            raise ExamError('找不到这个考场接口。')
        response = {'ok': True, 'data': result}
    except ExamError as error:
        response = {'ok': False, 'error': str(error)}
    response['state'] = json.dumps(manager.rooms, ensure_ascii=False)
    return response
