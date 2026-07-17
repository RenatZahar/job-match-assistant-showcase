
import pprint
from app.config import Settings
from app.feedback_storage import list_feedback_summaries_from_database


def main():
    settings = Settings()
    database_url = settings.database_online_url
    db_data = list_feedback_summaries_from_database(database_url, limit = 50, full_feedback_text=True)
    pprint.pprint(db_data)

if __name__ == "__main__":
    main()