// Records the nested shell's screen with GNOME Shell's own screencast
// service, from a process that stays alive while recording (the service
// stops when its caller goes away). Run by dev/record.sh.
//   gjs -m record.js <out.webm> <stop-file>
// Stops once <stop-file> exists.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const [out, stopFile] = ARGV;
const loop = new GLib.MainLoop(null, false);
const bus = Gio.DBus.session;
const call = (method, args) => new Promise((resolve, reject) =>
    bus.call('org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast',
        'org.gnome.Shell.Screencast', method, args, null, 0, -1, null,
        (_, res) => {
            try {
                resolve(bus.call_finish(res).deepUnpack());
            } catch (e) {
                reject(e);
            }
        }));

const options = {
    'draw-cursor': new GLib.Variant('b', true),
    'framerate': new GLib.Variant('i', 30),
};
call('Screencast', new GLib.Variant('(sa{sv})', [out, options])).then(([ok, file]) => {
    if (!ok)
        throw new Error('screencast refused');
    print(`recording ${file}`);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        if (!GLib.file_test(stopFile, GLib.FileTest.EXISTS))
            return GLib.SOURCE_CONTINUE;
        call('StopScreencast', null).finally(() => loop.quit());
        return GLib.SOURCE_REMOVE;
    });
}).catch(e => {
    printerr(e.message);
    loop.quit();
});
loop.run();
