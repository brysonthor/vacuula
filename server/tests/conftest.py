import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from vacuula_server import db, fork_db
from vacuula_server.db import Base
from vacuula_server.fork_db import ForkBase
from vacuula_server.models import error  # ensure error table metadata is registered


@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    # Use single-connection in-memory SQLite so all threads and sessions see the same DB
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    test_session_maker = sessionmaker(bind=test_engine, expire_on_commit=False, class_=Session)

    # Monkeypatch db and fork_db engine/SessionLocal
    db.engine = test_engine
    db.SessionLocal = test_session_maker
    fork_db.engine = test_engine

    # Create all tables
    Base.metadata.create_all(test_engine)
    ForkBase.metadata.create_all(test_engine)

    fork_db.ensure_fork_tables()

    yield test_engine


@pytest.fixture(autouse=True)
def clean_db_between_tests(setup_test_db):
    yield
    with setup_test_db.connect() as conn:
        for table in reversed(ForkBase.metadata.sorted_tables):
            conn.execute(table.delete())
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
        conn.commit()

