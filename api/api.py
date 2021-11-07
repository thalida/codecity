# Python
import os

os.environ['TZ'] = 'UTC'
import logging

# External
from dotenv import load_dotenv
from flask import Flask, make_response, jsonify, abort
from flask_cors import CORS

# App
from codecity import CodeWorld

load_dotenv()

logger = logging.getLogger(__name__)
app = Flask(__name__)
cors = CORS(app, resources={r"*": {"origins": "*"}})
codeworld = CodeWorld(owner="thalida", api_token=os.getenv('GITHUB_TOKEN'))

@app.route('/api/repos/<string:repo_name>', methods=['GET'])
def get_repo(repo_name):
    print(repo_name)
    try:
        repo = codeworld.get_or_create_city(repo_name)
        return make_response(jsonify(repo.tree))
    except Exception as e:
        logger.exception(e)
        abort(500)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port='8000', debug=True)
