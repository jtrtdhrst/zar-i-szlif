def meeting_summary(items):
    cleaned = [item.strip() for item in items if item.strip()]
    return "\n".join(f"{i}. {item}" for i, item in enumerate(cleaned, start=1))
