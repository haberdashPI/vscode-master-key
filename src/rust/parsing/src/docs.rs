#[allow(unused_imports)]
use log::info;

use core::ops::Range;
use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;

use crate::bind::{Binding, BindingDoc, CombinedBindingDoc};

pub(crate) struct FileDocLine {
    offset: usize,
    data: String,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct FileDocSection {
    doc: String,
    order: Vec<String>,
    bindings: HashMap<String, FileDocTableRow>,
}

#[derive(Clone, Debug, Serialize)]
struct FileDocTableRow {
    key: Vec<String>,
    mode: String,
    doc: BindingDoc,
    combine_count: i64,
}

impl FileDocTableRow {
    fn key(&self) -> String {
        if let Some(combined) = &self.doc.combined {
            return combined.name.clone();
        } else {
            return self.doc.name.clone();
        }
    }
    fn new(x: &Binding) -> Self {
        Self {
            key: x.key.clone(),
            mode: x.mode.join(", "),
            doc: x.doc.clone(),
            combine_count: 1,
        }
    }
    fn merge(&mut self, other: &Self) {
        self.doc.combined = if let Some(combined) = &self.doc.combined {
            Some(CombinedBindingDoc {
                name: combined.name.clone(),
                description: if combined.description.is_empty() {
                    if let Some(combined) = &other.doc.combined {
                        combined.description.clone()
                    } else {
                        combined.description.clone()
                    }
                } else {
                    combined.description.clone()
                },
                key: if combined.key.is_empty() {
                    if let Some(combined) = &other.doc.combined {
                        combined.key.clone()
                    } else {
                        combined.key.clone()
                    }
                } else {
                    combined.key.clone()
                },
            })
        } else {
            None
        };
        self.combine_count += other.combine_count;
    }

    fn as_markdown_row(&self, show_mode: bool) -> String {
        let newlines = regex::Regex::new(r"[\n\r]+").unwrap();
        let key = if let Some(combined) = &self.doc.combined
            && !combined.key.is_empty()
            && self.combine_count > 1
        {
            if self.key.len() > 1 {
                let mut key = self.key[0..(self.key.len() - 1)].join("</key> <key>");
                key.push_str("</key> <key>");
                key.push_str(combined.key.as_str());
                key
            } else {
                combined.key.clone()
            }
        } else {
            self.key.join("</key> <key>")
        };

        let name = if let Some(combined) = &self.doc.combined
            && self.combine_count > 1
        {
            newlines.replace_all(&combined.name, " ")
        } else {
            newlines.replace_all(&self.doc.name, " ")
        };

        let description = if let Some(combined) = &self.doc.combined
            && !combined.description.is_empty()
            && self.combine_count > 1
        {
            newlines.replace_all(&combined.description, " ")
        } else {
            newlines.replace_all(&self.doc.description, " ")
        };

        if show_mode {
            return format!(
                "| {} | <key>{key}</key> | {name} | {description} |",
                self.mode
            );
        } else {
            return format!("| <key>{key}</key> | {name} | {description} |");
        }
    }
}

impl FileDocLine {
    pub(crate) fn read(content: &[u8]) -> Vec<FileDocLine> {
        // NOTE: we know this byte stream is safe because it was converted from our own code
        // in typescript
        let content_str = unsafe { str::from_utf8_unchecked(content) };
        let lines = content_str.lines();
        let doc_line = Regex::new(r"^\s*##\s?(.*)").unwrap();
        let mut result = Vec::new();

        let mut offset = 0;
        let start = content_str.as_ptr() as usize;
        let mut last_doc_line = 0;
        for (line, line_str) in lines.enumerate() {
            if let Some(m) = doc_line.captures(line_str) {
                if let Some(data) = m.get(1) {
                    if last_doc_line < line - 1 {
                        // if we have a break in-between two literate comments we need to
                        // introduce a blank line in the resulting FileDocLine vector. This
                        // keeps different groupings of comments in separate markdown
                        // paragraphs.
                        result.push(FileDocLine {
                            data: "".to_string(),
                            offset,
                        });
                    }
                    last_doc_line = line;
                    result.push(FileDocLine {
                        data: data.as_str().to_string(),
                        offset,
                    });
                }
            }
            offset = (line_str.as_ptr() as usize) - start;
        }
        return result;
    }
}

enum FileDocElement {
    Doc(FileDocLine),
    Bind(FileDocTableRow, usize),
}

impl FileDocElement {
    fn offset(&self) -> usize {
        match self {
            FileDocElement::Doc(x) => x.offset,
            FileDocElement::Bind(_, offset) => *offset,
        }
    }
}

impl FileDocSection {
    fn new() -> Self {
        return FileDocSection {
            doc: String::new(),
            bindings: HashMap::new(),
            order: Vec::new(),
        };
    }

    pub(crate) fn assemble(
        bind: &Vec<Binding>,
        bind_span: &Vec<Range<usize>>,
        docs: Vec<FileDocLine>,
    ) -> Vec<FileDocSection> {
        let mut elements: Vec<_> = bind
            .iter()
            .zip(bind_span.iter())
            .map(|(b, s)| FileDocElement::Bind(FileDocTableRow::new(&b), s.start))
            .chain(docs.into_iter().map(|d| FileDocElement::Doc(d)))
            .collect();

        elements.sort_by_key(FileDocElement::offset);

        let mut result = Vec::new();
        let mut current_section = FileDocSection::new();
        // TODO: consolidate anything with the same combined.name
        for element in elements {
            match element {
                FileDocElement::Doc(x) => {
                    // we have new documentation elements after seeing bindings;
                    // time to start a new section
                    if current_section.bindings.len() > 0 {
                        result.push(current_section);
                        current_section = FileDocSection::new();
                    }
                    current_section.doc.push_str(x.data.as_str());
                    current_section.doc.push_str("\n");
                }
                FileDocElement::Bind(b, _) => {
                    if !b.doc.hideInDocs {
                        let key = b.key();
                        current_section
                            .bindings
                            .entry(key.clone())
                            .and_modify(|a| {
                                a.merge(&b);
                            })
                            .or_insert_with(|| {
                                current_section.order.push(key);
                                b
                            });
                    }
                }
            }
        }
        if !(current_section.doc.is_empty() && current_section.bindings.is_empty()) {
            result.push(current_section);
        };

        return result;
    }

    pub(crate) fn write_markdown(docs: &Vec<FileDocSection>, show_mode: bool) -> String {
        let mut result = String::new();
        for section in docs {
            result.push_str(section.doc.as_str());
            result.push_str("\n");
            if section.order.is_empty() {
                continue;
            }
            if show_mode {
                result.push_str("| mode | key | name | description |\n");
                result.push_str("| ---- | --- | ---- | ----------- |\n");
            } else {
                result.push_str("| key | name | description |\n");
                result.push_str("| --- | ---- | ----------- |\n");
            }
            for key in &section.order {
                let bind = &section.bindings[key.as_str()];
                let raw = bind.as_markdown_row(show_mode);
                // escape special characters in markdown
                let re = Regex::new(r"(\\|\[|\]|`|\*|_|\(|\)|\#|\+|-|\.|!)").unwrap();
                result.push_str(re.replace_all(raw.as_str(), "\\$1").to_string().as_str());
                result.push('\n');
            }
        }
        if docs.is_empty() {
            result.push_str(
                &"These bindings have no documentation; use ## in the original file to
                add literate documentation into the bindings file."
                    .replace("\n", " "),
            );
        }

        return result;
    }
}
