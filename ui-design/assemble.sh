#!/bin/bash
# usage: ./assemble.sh <Name> <navkey>
set -e
name=$1; key=$2
{
  sed "s|class=\"ni ni-$key\"|class=\"ni ni-$key on\"|" parts/head.html
  cat "parts/$name.body"
  cat parts/tail.html
  cat "parts/$name.logic"
  printf '</body>\n</html>\n'
} > "$name.dc.html"
echo "built $name.dc.html ($(wc -c < "$name.dc.html") bytes)"
