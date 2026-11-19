#!/usr/bin/env ruby
# Imports numbered clues from the supplied text export into the existing
# Scandinavian-crossword data format. Blank answers (a lone "?") are skipped.

require 'json'

source = ARGV.fetch(0)
root = File.expand_path('..', __dir__)

entries = []
puzzle = nil
direction = nil

File.foreach(source, encoding: 'UTF-8') do |raw_line|
  line = raw_line.strip
  if (match = line.match(/\AКРЪСТОСЛОВИЦА\s+(\d+)/))
    puzzle = match[1].to_i
    direction = nil
    next
  end

  if line == 'ХОРИЗОНТАЛНО' || line == 'ВЕРТИКАЛНО'
    direction = line
    next
  end

  next unless puzzle && direction
  match = line.match(/\A(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\z/)
  next unless match

  number, clue, raw_answer = match.captures
  next if raw_answer == '?'

  tentative = raw_answer.end_with?('?')
  answer = raw_answer.sub(/\s*\[.*\]\s*\z/, '')
                     .delete_suffix('?')
                     .unicode_normalize(:nfc)
                     .upcase
                     .tr('Ё', 'Е')
                     .gsub(/[^А-Я]/, '')
  next if answer.empty?
  raise "Отговорът е твърде дълъг за решетка 21×25: #{raw_answer}" if answer.length > 24

  entries << {
    puzzle: puzzle,
    direction: direction,
    number: number.to_i,
    clue: clue,
    answer: answer,
    tentative: tentative
  }
end

raise 'Във файла не бяха намерени попълнени отговори.' if entries.empty?

# The runtime maps definitions to answer strings, so repeated answers share all
# of their original definitions. Number and direction stay in the displayed
# clue because the old data model has no separate numbering fields.
dictionary = entries.group_by { |entry| entry[:answer] }.map do |answer, group|
  clues = group.map do |entry|
    prefix = "Кр. #{entry[:puzzle]}, #{entry[:direction].downcase}, №#{entry[:number]}: "
    prefix + entry[:clue]
  end.uniq
  { word: answer, clues: clues }
end.sort_by { |entry| [entry[:word].length, entry[:word]] }

# Use vertical lanes separated by clue columns. This preserves the established
# 21×25 Scandinavian grid and guarantees that no old/accidental answers remain.
def build_grids(entries, width, height)
  columns = (1...width).step(2).to_a
  fitting = entries.select { |entry| entry[:answer].length < height }
  fitting.each_slice(columns.length).map do |slice|
    grid = Array.new(height) { Array.new(width, '#') }
    slice.each_with_index do |entry, index|
      column = columns[index]
      entry[:answer].chars.each_with_index do |letter, offset|
        grid[1 + offset][column] = letter
      end
    end
    grid.map(&:join).join('|')
  end
end

pools = {
  s: build_grids(entries, 7, 9),
  m: build_grids(entries, 8, 10),
  l: build_grids(entries, 21, 25)
}

dimensions = { s: [9, 7], m: [10, 8], l: [25, 21] }
known_words = dictionary.to_h { |entry| [entry[:word], true] }
pools.each do |size, grids|
  height, width = dimensions.fetch(size)
  grids.each_with_index do |encoded, index|
    rows = encoded.split('|')
    raise "Невалидни размери за #{size}-#{index}." unless rows.length == height && rows.all? { |row| row.length == width }

    columns = (0...width).flat_map do |column|
      rows.map { |row| row[column] }.join.split('#').select { |word| word.length >= 2 }
    end
    unknown = columns.reject { |word| known_words[word] }
    raise "Неизвестни думи в #{size}-#{index}: #{unknown.join(', ')}" unless unknown.empty?
  end
end

dictionary_json = JSON.generate(dictionary)
pools_json = JSON.generate(pools)

File.write(File.join(root, 'public', 'dictionary.js'),
           "/* Въпроси и отговори, импортирани от krastoslovici_questions.txt. */\n" \
           "window.CROSSWORD_DICTIONARY = #{dictionary_json};\n")
File.write(File.join(root, 'src', 'pools.json'), pools_json + "\n")
File.write(File.join(root, 'public', 'pools.js'),
           "/* Решетки, импортирани от krastoslovici_questions.txt. */\n" \
           "window.CROSSWORD_POOLS = #{pools_json};\n")

confirmed = entries.count { |entry| !entry[:tentative] }
tentative = entries.count { |entry| entry[:tentative] }
warn "Импортирани: #{entries.length} отговора (#{confirmed} без ?, #{tentative} отбелязани като предположения), #{pools[:l].length} решетки."
