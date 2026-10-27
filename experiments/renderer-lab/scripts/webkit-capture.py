"""Actual WebKitGTK engine smoke check on a private Xvfb display, never :0."""
import os, sys, json, pathlib, threading, http.server, socketserver, time
import gi
if os.environ.get('PIGEONCOOP_GI_EXT'):gi.__path__.append(os.environ['PIGEONCOOP_GI_EXT'])
gi.require_foreign('cairo')
gi.require_version('Gtk','3.0'); gi.require_version('WebKit2','4.1')
from gi.repository import Gtk, WebKit2, GLib, Gdk
assert os.environ.get('PIGEONCOOP_PRIVATE_DISPLAY') == '1'
assert os.environ.get('DISPLAY') not in (None,':0',':0.0')
variant=os.environ.get('PIGEONCOOP_WEBKIT_VARIANT','default')
assert variant in ('default','gl1','preserve','canvas','latest','canvas-rust','pixi-canvas','checkpoint')
root=pathlib.Path(__file__).resolve().parent.parent; output=root/'evidence'/f'linux-webkit-{variant}'; output.mkdir(parents=True,exist_ok=True)
paths={'/':('web/comparison.html','text/html'),'/style.css':('web/style.css','text/css'),'/scene.mjs':('web/scene.mjs','text/javascript'),'/comparison-scene.mjs':('web/comparison-scene.mjs','text/javascript'),'/draw-adapters.mjs':('web/draw-adapters.mjs','text/javascript'),'/fixture.mjs':('web/fixture.mjs','text/javascript'),'/world-data.mjs':('web/world-data.mjs','text/javascript'),'/pixi.min.js':('web/pixi.min.js','text/javascript'),'/pixi-8.22.min.js':('web/pixi-8.22.min.js','text/javascript'),'/assets/actors.png':('assets/actors.png','image/png')}
for url,path,kind in [('/rust-sampler.mjs','web/rust-sampler.mjs','text/javascript'),('/assets/presentation.wasm','assets/presentation.wasm','application/wasm'),('/assets/exported-atlas.json','assets/exported-atlas.json','application/json'),('/assets/worker-a-export.png','assets/worker-a-export.png','image/png'),('/assets/worker-b-export.png','assets/worker-b-export.png','image/png')]:paths[url]=(path,kind)
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        entry=paths.get(self.path.split('?')[0])
        if not entry:self.send_error(404);return
        data=(root/entry[0]).read_bytes();self.send_response(200);self.send_header('Content-Type',entry[1]);self.end_headers();self.wfile.write(data)
    def log_message(self,*args):pass
server=socketserver.TCPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
view=WebKit2.WebView(); settings=view.get_settings();settings.set_enable_webgl(True)
window=Gtk.Window();window.set_default_size(1280,800);window.add(view)
result={'scope':'Actual WebKitGTK under private WSL/Xvfb display, software graphics; no Tauri shell qualification','webkit_version':f'{WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}','variant':variant,'renderer_string_note':'WebKit may sanitize renderer identity; Apple GPU is not the machine hardware','captures':[]}
shots=[('03-handoff',{'time':3700}),('05-contact-lost',{'time':5200,'scenario':'stale'}),('08-reduced',{'time':2000,'scenario':'normal','reduced':True})]
started=time.monotonic();index=0
result['capture_info']={}
def finish(error=None):
    if error:result['error']=str(error)
    (output/'webkit-report.json').write_text(json.dumps(result,indent=2));Gtk.main_quit()
def evaluate(script,callback):
    def completed(obj,res,*args):
        try:callback(obj.evaluate_javascript_finish(res))
        except Exception as error:finish(error)
    view.evaluate_javascript(script,-1,None,None,None,completed,None)
def capture_next(*args):
    global index
    if index>=len(shots):finish();return
    name,params=shots[index]
    def after_set(value):
        def saved(obj,res,*args):
            global index
            try:
                surface=obj.get_snapshot_finish(res)
                data=bytes(surface.get_data())
                assert any(data[i] for i in range(0,len(data),4)), 'Snapshot is entirely black'
                surface.write_to_png(str(output/f'{name}.png'))
                result['captures'].append(name);index+=1;GLib.timeout_add(100,capture_next)
            except Exception as error:finish(error)
        evaluate('JSON.stringify(lab.captureInfo())',lambda info:(result['capture_info'].update({name:json.loads(info.to_string())}),GLib.timeout_add(200,lambda:(view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE,WebKit2.SnapshotOptions.NONE,None,saved,None),False)[1])))
    evaluate(f'JSON.stringify(lab.set({json.dumps(params)}))',after_set)
    return False
def poll_ready():
    if time.monotonic()-started>25:finish('Viewer did not become ready within 25 seconds');return False
    def checked(value):
        if value.to_boolean():
            result['ready_ms']=(time.monotonic()-started)*1000
            evaluate('JSON.stringify(lab.rendererInfo())',lambda info:(result.update(renderer=json.loads(info.to_string())),capture_next()))
        else:GLib.timeout_add(150,poll_ready)
    evaluate('Boolean(globalThis.labReady)',checked);return False
query={'default':'?renderer=pixi&core=js&atlas=untrimmed','gl1':'?renderer=pixi&core=js&atlas=untrimmed&gl=1','preserve':'?renderer=pixi&core=js&atlas=untrimmed&preserve=1','canvas':'?renderer=canvas','latest':'?renderer=pixi&bundle=latest&core=js&atlas=untrimmed','canvas-rust':'?renderer=canvas&core=rust&atlas=packed','pixi-canvas':'?renderer=pixi-canvas&bundle=latest&core=rust&atlas=packed','checkpoint':''}[variant]
view.load_uri(f'http://127.0.0.1:{server.server_address[1]}/{query}');window.show_all();GLib.timeout_add(200,poll_ready);GLib.timeout_add_seconds(35,lambda:(finish('Global timeout'),False)[1]);Gtk.main();server.shutdown();print(json.dumps(result));sys.exit(1 if 'error' in result else 0)
