# Python
import os

os.environ["TZ"] = "UTC"
import logging

# External
from dotenv import load_dotenv
from flask import Flask, make_response, jsonify, abort, request
from flask_cors import CORS

# App
import repo

load_dotenv()

logger = logging.getLogger(__name__)
app = Flask(__name__)
cors = CORS(app, resources={r"*": {"origins": "*"}})


@app.route("/api/repo", methods=["GET"])
def get_repo():
    repo_url = request.args.get("url")
    try:
        response = repo.get_repo(repo_url)
        return make_response(jsonify(response))
    except Exception as e:
        logger.exception(e)
        abort(500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port="8000", debug=True)
