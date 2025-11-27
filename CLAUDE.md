# CLAUDE.md - AI Assistant Guidelines for chat-avatar

This document provides comprehensive guidance for AI assistants working on the chat-avatar project.

## Project Overview

**Project Name:** chat-avatar
**Status:** Early development stage
**Repository:** tarysos/chat-avatar

### Project Purpose
The chat-avatar project is currently in its initial stages. As development progresses, this section should be updated with:
- Project goals and objectives
- Key features and functionality
- Target users and use cases
- Technology stack decisions

## Repository Structure

### Current Structure
```
chat-avatar/
├── .git/              # Git repository metadata
├── README.md          # Project readme
└── CLAUDE.md          # This file - AI assistant guidelines
```

### Expected Structure (to be developed)
As the project grows, maintain clear organization:
```
chat-avatar/
├── src/               # Source code
├── tests/             # Test files
├── docs/              # Documentation
├── config/            # Configuration files
├── scripts/           # Build and deployment scripts
├── .github/           # GitHub workflows and templates
├── README.md          # Project readme
├── CLAUDE.md          # AI assistant guidelines
└── [config files]     # package.json, requirements.txt, etc.
```

## Development Workflow

### Branch Strategy

**Main Development Branch:** `claude/claude-md-mih1oxp9x6mdifny-01XUczXHoXsbVbUjtbRYst3H`

#### Branch Naming Conventions
- Feature branches: `claude/[description]-[session-id]`
- All development should occur on designated Claude branches
- Branch names must start with `claude/` and end with the session ID

#### Git Operations

**Committing Changes:**
- Write clear, descriptive commit messages
- Follow conventional commit format when possible:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation changes
  - `refactor:` for code refactoring
  - `test:` for test additions/changes
  - `chore:` for maintenance tasks

**Pushing Changes:**
- Always use: `git push -u origin <branch-name>`
- Branch must start with `claude/` and end with matching session ID
- On network failures, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s)

**Pulling/Fetching:**
- Prefer specific branches: `git fetch origin <branch-name>`
- Use retry logic on network failures (same backoff as push)

### Commit Message Guidelines

Good commit messages:
- Start with a verb in imperative mood ("Add", "Fix", "Update", not "Added", "Fixed", "Updated")
- Be concise but descriptive (50-72 characters for subject)
- Focus on the "why" rather than just the "what"
- Reference issues/PRs when relevant

Examples:
```
feat: Add user avatar upload functionality
fix: Prevent chat message duplication on reconnect
docs: Update API documentation for avatar endpoints
refactor: Extract avatar processing into separate module
```

## Code Conventions

### General Principles

1. **Keep It Simple:** Avoid over-engineering
   - Only make changes that are directly requested or clearly necessary
   - Don't add features, refactor code, or make "improvements" beyond what was asked
   - Three similar lines of code is better than a premature abstraction

2. **Security First:**
   - Be vigilant against OWASP Top 10 vulnerabilities
   - Validate all user input at system boundaries
   - Avoid command injection, XSS, SQL injection
   - Use parameterized queries/prepared statements
   - Sanitize and validate external data

3. **No Backwards Compatibility Hacks:**
   - Don't rename unused variables with `_` prefix
   - Don't add `// removed` comments for deleted code
   - If something is unused, delete it completely
   - Trust the version control system

4. **Minimal Error Handling:**
   - Only validate at system boundaries (user input, external APIs)
   - Trust internal code and framework guarantees
   - Don't add error handling for scenarios that can't happen

5. **Documentation:**
   - Only add comments where logic isn't self-evident
   - Don't add docstrings/comments to unchanged code
   - Prefer self-documenting code with clear naming

### Code Style

**To be established based on chosen technology stack:**
- Language-specific style guides will be added as technologies are selected
- Use consistent formatting (consider adding linters/formatters)
- Follow community best practices for chosen frameworks

## Testing Guidelines

### Testing Philosophy
- Write tests for new features and bug fixes
- Maintain existing tests when refactoring
- Don't write tests for trivial functionality
- Focus on integration tests for critical paths

### Test Organization
```
tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
├── e2e/              # End-to-end tests
└── fixtures/         # Test data and fixtures
```

### Running Tests
*To be added when test framework is established*

## File Operations

### Reading Files
- Use the Read tool for file contents (not `cat`, `head`, `tail`)
- Read files before making changes to understand context
- Never propose changes to code you haven't read

### Editing Files
- Use the Edit tool for modifications (not `sed`, `awk`)
- Preserve exact indentation and formatting
- Make surgical changes - only modify what's necessary

### Writing Files
- Use the Write tool for new files (not `echo >` or `cat <<EOF`)
- Read existing files first before overwriting
- Prefer editing over creating new files
- Never create files unless absolutely necessary
- Don't create documentation files proactively (only when requested)

### Searching Files
- Use Glob for file pattern matching (not `find`, `ls`)
- Use Grep for content search (not `grep`, `rg` commands)
- For open-ended exploration, use Task tool with subagent_type=Explore

## AI Assistant Workflows

### For Questions/Analysis
1. Use Task tool with subagent_type=Explore for codebase exploration
2. Read relevant files to understand context
3. Provide detailed answers with file references (use `file:line` format)
4. Cite specific code locations when relevant

### For Implementations
1. **Plan:**
   - Use TodoWrite to create a task list for complex work
   - Break down tasks into specific, actionable items
   - Always have exactly ONE task in_progress at a time

2. **Research:**
   - Read existing code before making changes
   - Understand current patterns and conventions
   - Search for similar implementations in the codebase

3. **Implement:**
   - Mark task as in_progress before starting work
   - Make focused, minimal changes
   - Test changes when possible
   - Mark task as completed immediately after finishing

4. **Commit & Push:**
   - Stage relevant files
   - Write clear commit message
   - Verify with `git status`
   - Push to the designated branch

### Task Management

Use TodoWrite tool for:
- Complex multi-step tasks (3+ steps)
- Non-trivial implementations
- Multiple related changes
- User-provided task lists

Don't use TodoWrite for:
- Single straightforward tasks
- Trivial changes
- Purely conversational interactions

**Task States:**
- `pending`: Not yet started
- `in_progress`: Currently working (exactly ONE at a time)
- `completed`: Finished successfully

**Task Completion:**
- Only mark completed when FULLY accomplished
- If blocked/errored, keep as in_progress and create blocker task
- Never batch completions - mark done immediately after finishing

### Communication Style

- Be concise and direct
- No emojis unless explicitly requested
- Output text directly (never use `echo` or comments to communicate)
- Focus on facts and technical accuracy
- Provide objective guidance, even if it contradicts user assumptions
- Use GitHub-flavored markdown for formatting

### Tool Usage Best Practices

1. **Parallel Tool Calls:**
   - When operations are independent, call tools in parallel
   - Send single message with multiple tool invocations
   - Example: Multiple file reads, parallel searches

2. **Sequential Operations:**
   - Use sequential calls when operations depend on previous results
   - Chain with `&&` in Bash when appropriate
   - Example: `git add . && git commit -m "message" && git push`

3. **Specialized Tools Over Bash:**
   - Read instead of cat/head/tail
   - Edit instead of sed/awk
   - Write instead of echo>/cat<<EOF
   - Glob instead of find/ls
   - Grep instead of grep/rg commands

## Documentation Standards

### README.md
- Keep updated with project setup instructions
- Document dependencies and requirements
- Include usage examples
- Maintain installation/build instructions

### Code Comments
- Explain "why" not "what"
- Document complex algorithms or business logic
- Keep comments up-to-date with code changes
- Remove obsolete comments

### This File (CLAUDE.md)
- Update when conventions change
- Document new patterns as they emerge
- Keep structure and guidelines current
- Add technology-specific sections as stack is defined

## Project-Specific Conventions

*This section will be populated as the project develops and conventions are established.*

### Naming Conventions
*To be defined*

### API Design
*To be defined*

### Database Schema
*To be defined*

### Architecture Patterns
*To be defined*

## Common Pitfalls to Avoid

1. **Don't guess file contents** - Always read files before modifying
2. **Don't over-engineer** - Keep solutions simple and focused
3. **Don't create unnecessary files** - Prefer editing existing files
4. **Don't add features not requested** - Stay focused on the task
5. **Don't skip security validation** - Validate at system boundaries
6. **Don't forget to commit and push** - Complete the workflow
7. **Don't batch todo completions** - Mark done immediately
8. **Don't use bash for file operations** - Use specialized tools
9. **Don't add comments to unchanged code** - Only document what you modify
10. **Don't create abstractions prematurely** - Wait for clear patterns

## Reference Information

**Git Remote:** origin
**Current Branch:** claude/claude-md-mih1oxp9x6mdifny-01XUczXHoXsbVbUjtbRYst3H
**Last Updated:** 2025-11-27

## Quick Reference Commands

### Git Operations
```bash
# Check status
git status

# Stage changes
git add <files>

# Commit with message
git commit -m "type: description"

# Push to branch
git push -u origin <branch-name>

# View recent commits
git log --oneline -10

# View diff
git diff
```

### Code Navigation
Use file:line format for references:
- `src/components/Avatar.tsx:42`
- `tests/avatar.test.js:15`

---

**Note:** This is a living document. Update it as the project evolves, conventions are established, and new patterns emerge. Keep it current to maintain its usefulness for AI assistants working on this codebase.
