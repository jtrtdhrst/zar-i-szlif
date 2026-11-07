def build_meeting_digest(title, attendees, actions):
    if not isinstance(title, str):
        raise TypeError("title must be a string")
    cleaned_title = title.strip()
    if not cleaned_title:
        raise ValueError("title must not be empty")

    cleaned_attendees = []
    seen = set()
    for attendee in attendees:
        if not isinstance(attendee, str):
            raise TypeError("attendees must be strings")
        cleaned = attendee.strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned_attendees.append(cleaned)

    cleaned_actions = []
    for action in actions:
        if not isinstance(action, str):
            raise TypeError("actions must be strings")
        cleaned = action.strip()
        if not cleaned:
            continue
        cleaned_actions.append(cleaned)

    return {
        "title": cleaned_title,
        "attendees": cleaned_attendees,
        "actions": cleaned_actions,
        "action_count": len(cleaned_actions),
    }
