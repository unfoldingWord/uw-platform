import re, base64, json, io, os

SCREENS = [
    ("Main","today","Today"),("Search","today","Command palette"),("Pages","pages","Pages & Wiki"),
    ("Cascade","cascade","Strategic Cascade"),("MeetingsHome","meetings","Meetings"),("Meetings","meetings","Meeting"),
    ("Crosswalk","crosswalk","JD Crosswalk"),("AreaHome","field","Area home"),("Directory","directory","Directory & Access"),
    ("Ledger","ledger","Ledger"),("Charts","charts","Budgets & Charts"),("Contracts","contracts","Contracts & MOUs"),
    ("Expenses","expenses","Expenses"),("Compliance","compliance","Compliance"),
    ("Crm","crm","CRM & Giving"),("Grants","grants","Grants"),("StoryBank","stories","Story Bank"),
    ("Impact","impact","Impact Models"),("Field","field","Engagements"),
    ("Products","products","Products"),("Development","dev","Development"),
    ("Health","health","Health"),("AgentQueues","agents","Agent Queues"),("Modules","modules","Modules"),
    ("Offline","offline","Desktop & Offline"),
]
NAV2SCREEN = {n:s for s,n,_ in SCREENS if s not in ("Search","Meetings","AreaHome")}
NAV2SCREEN["meetings"]="MeetingsHome"
NAV2SCREEN["field"]="Field"

head = open("parts/head.html").read()
css = re.search(r"<style>(.*?)</style>", head, re.S).group(1)
aside = re.search(r"(<aside class=\"side\">.*?</aside>)", head, re.S).group(1)
logo = base64.b64encode(open("uw-logo.png","rb").read()).decode()
aside = aside.replace('src="uw-logo.png"', 'src="data:image/png;base64,%s"' % logo)
# make nav items switch screens
def navsub(m):
    key = m.group(1)
    scr = NAV2SCREEN.get(key)
    return '<a class="ni ni-%s" data-nav="%s"' % (key, scr or "")
aside = re.sub(r'<a class="ni ni-([a-z]+)"', navsub, aside)

parts = []
for name, navkey, _ in SCREENS:
    body = open("parts/%s.body" % name).read()
    logic = open("parts/%s.logic" % name).read()
    logic = re.sub(r"^<script[^>]*>", "", logic.strip())
    logic = logic.replace("</script>", "")
    parts.append((name, navkey, body, logic))

out = io.StringIO()
out.write('<meta charset="utf-8">\n')
out.write('<title>unfoldingWord Platform Prototype</title>\n')
out.write('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800;6..12,900&display=swap">\n')
out.write("<style>%s\n" % css)
out.write("""
  html,body{background:var(--bg);}
  .app{width:100%;min-width:1300px;height:100vh;}
  .side{overflow:auto;}
  .ni{cursor:pointer;}
  .search{cursor:pointer;}
  @media (max-width:1200px){ body{overflow-x:auto;} }
</style>
""")
out.write('<div id="root"></div>\n')
out.write("<script>\n")
out.write("var ASIDE = %s;\n" % json.dumps(aside))
out.write("var SCREENS = {};\nvar ORDER = %s;\n" % json.dumps([s for s,_,_ in SCREENS]))
for name, navkey, body, logic in parts:
    out.write("SCREENS[%s] = { nav: %s, body: %s, make: (function(){ %s\n return Component; })() };\n"
              % (json.dumps(name), json.dumps(navkey), json.dumps(body), logic))
out.write(open("runtime.js").read())
out.write("\n</script>\n")
open("../uw-platform-prototype.html","w").write(out.getvalue())
print("wrote uw-platform-prototype.html", os.path.getsize("../uw-platform-prototype.html"), "bytes")
