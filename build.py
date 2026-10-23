import os

BASE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(BASE, "data.json"), encoding="utf-8") as f:
    data_str = f.read()
data_str_safe = data_str.replace("</script", "<\\/script").replace("<!--", "<\\!--")

with open(os.path.join(BASE, "template.html"), encoding="utf-8") as f:
    template = f.read()
with open(os.path.join(BASE, "app.js"), encoding="utf-8") as f:
    appjs = f.read()

with open(os.path.join(BASE, "features.js"), encoding="utf-8") as f:
    featuresjs = f.read()
assert "//@@FEATURES@@" in appjs, "falta el marcador //@@FEATURES@@ en app.js"
with open(os.path.join(BASE, "trends.js"), encoding="utf-8") as f:
    trendsjs = f.read()
appjs = appjs.replace("//@@FEATURES@@", featuresjs + "\n" + trendsjs)

out = template.replace("__DATA_JSON__", data_str_safe).replace("__APP_JS__", appjs)

with open(os.path.join(BASE, "index.html"), "w", encoding="utf-8") as f:
    f.write(out)

print("wrote index.html", len(out), "bytes")
