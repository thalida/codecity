# Python
import os

os.environ['TZ'] = 'UTC'
import logging

# External
from dotenv import load_dotenv
from flask import Flask, make_response, jsonify, abort
from flask_cors import CORS

# App
from codecity import CodeWorld, GitPython

load_dotenv()

logger = logging.getLogger(__name__)
app = Flask(__name__)
cors = CORS(app, resources={r"*": {"origins": "*"}})

allWorldsByOwner = {}
@app.route('/api/repos/<string:repo_owner>/<string:repo_name>', methods=['GET'])
def get_repo(repo_owner, repo_name):
    try:
        if (repo_owner not in allWorldsByOwner):
            allWorldsByOwner[repo_owner] = CodeWorld(owner=repo_owner, api_token=os.getenv('GITHUB_TOKEN'))

        codeworld = allWorldsByOwner[repo_owner]
        repo = codeworld.get_or_create_city(repo_name)
        return make_response(jsonify(repo.tree))
    except Exception as e:
        logger.exception(e)
        abort(500)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port='8000', debug=True)
