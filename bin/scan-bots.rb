
$stdin.read.scan(/^.+?\b([\w\-.]+bot[\w\-.]*)/i).group_by(&:first).
  inject({}) do |result, (name, lines)|
    result[name] = lines.size
    result
  end.sort_by do |name, count|
    -count
  end.each do |name, count|
    printf "%25s %10s\n", name, count
  end
