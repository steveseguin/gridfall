"""Serve the compiled browser game locally, with portable module MIME types."""
from functools import partial
from http.server import HTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import argparse

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=8196)
args=parser.parse_args()
class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.wasm':'application/wasm'}
root=Path(__file__).resolve().parents[1]/'web'
server=HTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(root)))
print(f'GRIDFALL: http://127.0.0.1:{args.port}/',flush=True)
try:server.serve_forever()
except KeyboardInterrupt:pass
finally:server.server_close()
