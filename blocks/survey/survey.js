/* Note: console.error is used for error tracking and monitoring */

/*
  Survey block for AEM Edge Delivery Services.
  Radios, sliders, and read-only "fact" slides.
  Builds DOM nodes (no innerHTML), tracks progress, supports grouped questions.
*/

// Import faintly for template rendering (POC/Learning)
import { renderBlock } from '../../scripts/faintly.js';

// Feature flag for faintly templates (set to false to use original code)
const USE_FAINTLY_TEMPLATES = true;

// Constants used across the survey
const SURVEY_CONSTANTS = {
  MANDATORY_TRUE: 'TRUE',
  QUESTION_TYPE: 'question',
  FACT_TYPE: 'fact',
  SLIDER_TYPE: 'slider',
  RADIO_TYPE: 'radio',
};

// Error logger - always logs errors to console for monitoring
function logError(...args) {
  // eslint-disable-next-line no-console
  console.error(...args);
}

// Required only if mandatory and it's an actual question (facts don't count)
function isAnswerRequired(question) {
  return (
    question.Mandatory === SURVEY_CONSTANTS.MANDATORY_TRUE
    && question.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE
  );
}

// Null/undefined means unanswered; empty string may be valid for some types
function hasValidAnswer(question, answers) {
  return answers[question.ContentId] != null;
}

// Find all related questions starting from a given index (q5a, q5b, q5c, etc.)
function findRelatedQuestions(surveyData, startIndex) {
  const relatedQuestions = [surveyData[startIndex]];
  const baseId = surveyData[startIndex].ContentId.replace(/[a-z]$/, '');

  // Only consider it a group if the base ID is different from the original (has letter suffix)
  if (baseId === surveyData[startIndex].ContentId) {
    return relatedQuestions; // Single question, no related ones
  }

  // Look for subsequent questions with the same base ID
  for (let i = startIndex + 1; i < surveyData.length; i += 1) {
    const currentQuestion = surveyData[i];
    const currentBaseId = currentQuestion.ContentId.replace(/[a-z]$/, '');

    if (
      currentBaseId === baseId
      && currentBaseId !== currentQuestion.ContentId
    ) {
      relatedQuestions.push(currentQuestion);
    } else {
      break; // Stop when we find a question that doesn't belong to this group
    }
  }

  return relatedQuestions;
}

// Small helper to create elements
function createElement(tag, className = '', textContent = '', attributes = {}) {
  const element = document.createElement(tag);
  if (className) element.classList.add(...className.split(' '));
  if (textContent) element.textContent = textContent;

  Object.entries(attributes).forEach(([key, value]) => {
    if (key.startsWith('data-')) {
      element.dataset[key.replace('data-', '')] = value;
    } else {
      element.setAttribute(key, value);
    }
  });

  return element;
}

// Div helper
function createDiv(className = '', textContent = '') {
  return createElement('div', className, textContent);
}

// Button helper
function createButton(className, textContent, type = 'button') {
  return createElement('button', className, textContent, { type });
}

// Add class if needed
function addClassIf(element, className, condition = true) {
  if (element && condition) {
    element.classList.add(className);
  }
}

// Move node to target parent and add class
function moveNode(node, targetParent, className) {
  if (node) {
    addClassIf(node, className);
    if (targetParent && node.parentElement !== targetParent) {
      targetParent.appendChild(node);
    }
  }
}

// Append children
function appendChildren(parent, children) {
  children.forEach((child) => {
    if (child) parent.appendChild(child);
  });
  return parent;
}

// Attach the same listener to multiple elements
function attachListeners(elements, eventType, handler) {
  elements.forEach((element) => {
    if (element) element.addEventListener(eventType, handler);
  });
}

// Replace container content safely
function replaceContent(container, newContent) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (typeof newContent === 'string') {
    container.textContent = newContent;
  } else if (newContent) {
    container.appendChild(newContent);
  }
}

// Build radio options for a question
function createRadioOptions(contentId, options) {
  const optionElements = options.map((option) => {
    const input = createElement('input', '', '', {
      type: 'radio',
      id: `${contentId}-${option.replace(/\s+/g, '-').toLowerCase()}`,
      name: contentId,
      value: option,
    });

    const label = createElement('label', '', option, {
      for: input.id,
    });

    return appendChildren(createDiv('option'), [input, label]);
  });

  return appendChildren(createDiv('options'), optionElements);
}

// Slider + labels (labels stored in data-options)
function createSlider(contentId, options, questionText = '') {
  const elements = [];

  if (questionText) {
    elements.push(createElement('h3', 'slider-question', questionText));
  }

  const labelSpans = options.map((option) => createElement('span', '', option));
  const labelsDiv = appendChildren(createDiv('slider-labels'), labelSpans);

  const slider = createElement('input', 'slider', '', {
    type: 'range',
    id: contentId,
    name: contentId,
    min: '0',
    max: String(options.length - 1),
    value: '0',
    'data-options': JSON.stringify(options),
  });

  const trackWrapper = appendChildren(createDiv('slider-track-wrapper'), [
    labelsDiv,
    slider,
  ]);

  elements.push(trackWrapper);
  return appendChildren(createDiv('slider-container'), elements);
}

// Fetch survey JSON; supports pretty hrefs via /paths.json
async function fetchSurveyData(surveyHref) {
  let mapping = surveyHref;
  if (!surveyHref.endsWith('json')) {
    const mappingresp = await fetch('/paths.json');
    const mappingData = await mappingresp.json();
    const mappingEntries = Object.entries(mappingData.mappings);
    const foundMapping = mappingEntries.find(([, value]) => {
      const [before] = value.split(':');
      return before === surveyHref;
    });
    if (foundMapping) {
      const [, after] = foundMapping[1].split(':');
      mapping = after;
    }
  }
  const resp = await fetch(mapping);
  const json = await resp.json();
  return json;
}

// Normalize API payload (Options can be CSV)
function parseSurveyData(surveyResponse) {
  const questions = surveyResponse.data || [];

  const normalizedQuestions = questions.map((item) => {
    if (item.Options && typeof item.Options === 'string') {
      item.Options = item.Options.split(',').map((opt) => opt.trim());
    }
    return item;
  });

  return normalizedQuestions.sort(
    (a, b) => parseInt(a.Order, 10) - parseInt(b.Order, 10),
  );
}

// Compute progress over counted questions
function calculateProgress(currentIndex, surveyData) {
  const actualQuestions = surveyData.filter(
    (q) => q.CountsAsQuestion === 'TRUE',
  );
  const totalActualQuestions = actualQuestions.length;

  const questionsCompleted = surveyData
    .slice(0, currentIndex + 1)
    .filter((q) => q.CountsAsQuestion === 'TRUE').length;

  const progress = (questionsCompleted / totalActualQuestions) * 100;
  return { progress, questionsCompleted, totalActualQuestions };
}

// Create progress bar using faintly template (Phase 2)
async function createProgressTemplate(progress, questionsCompleted, totalActualQuestions) {
  if (!USE_FAINTLY_TEMPLATES) {
    // Fallback to original DOM creation
    const progressFill = createDiv('progress-fill');
    progressFill.style.width = `${progress}%`;
    const progressTrack = appendChildren(createDiv('progress-track'), [
      progressFill,
    ]);
    const progressCounter = createDiv(
      'progress-counter',
      `${questionsCompleted}/${totalActualQuestions}`,
    );
    return appendChildren(createDiv('progress'), [
      progressTrack,
      progressCounter,
    ]);
  }

  try {
    // Use faintly template
    const progressContainer = document.createElement('div');
    progressContainer.dataset.blockName = 'survey';

    await renderBlock(progressContainer, {
      blockName: 'survey',
      template: { name: 'progress' },
      codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
      progress,
      questionsCompleted,
      totalActualQuestions,
    });

    return progressContainer.firstElementChild; // Return the actual progress div
  } catch (error) {
    logError('Progress template failed, falling back to DOM creation:', error);
    // Fallback to original DOM creation
    const progressFill = createDiv('progress-fill');
    progressFill.style.width = `${progress}%`;
    const progressTrack = appendChildren(createDiv('progress-track'), [
      progressFill,
    ]);
    const progressCounter = createDiv(
      'progress-counter',
      `${questionsCompleted}/${totalActualQuestions}`,
    );
    return appendChildren(createDiv('progress'), [
      progressTrack,
      progressCounter,
    ]);
  }
}

// Create navigation using faintly template (Phase 2)
async function createNavigationTemplate() {
  if (!USE_FAINTLY_TEMPLATES) {
    // Fallback to original DOM creation
    return appendChildren(createDiv('nav'), [
      createButton('btn-back', 'Back'),
      createButton('btn-next', 'Next'),
    ]);
  }

  try {
    // Use faintly template
    const navContainer = document.createElement('div');
    navContainer.dataset.blockName = 'survey';

    await renderBlock(navContainer, {
      blockName: 'survey',
      template: { name: 'navigation' },
      codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
    });

    return navContainer.firstElementChild; // Return the actual nav div
  } catch (error) {
    logError('Navigation template failed, falling back to DOM creation:', error);
    // Fallback to original DOM creation
    return appendChildren(createDiv('nav'), [
      createButton('btn-back', 'Back'),
      createButton('btn-next', 'Next'),
    ]);
  }
}

// Create fact content using faintly template (Phase 3)
async function createFactContentTemplate(title, question) {
  if (!USE_FAINTLY_TEMPLATES) {
    // Fallback to original DOM creation
    return appendChildren(createDiv(), [
      createElement('h1', 'title', title),
      createElement('p', 'fact-content', question),
    ]);
  }

  try {
    // Use faintly template
    const factContainer = document.createElement('div');
    factContainer.dataset.blockName = 'survey';

    await renderBlock(factContainer, {
      blockName: 'survey',
      template: { name: 'fact-content' },
      codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
      title,
      question,
    });

    return factContainer.firstElementChild; // Return the actual content div
  } catch (error) {
    logError('Fact content template failed, falling back to DOM creation:', error);
    // Fallback to original DOM creation
    return appendChildren(createDiv(), [
      createElement('h1', 'title', title),
      createElement('p', 'fact-content', question),
    ]);
  }
}

// Create radio options using faintly template (Phase 4)
async function createRadioOptionsTemplate(contentId, options) {
  if (!USE_FAINTLY_TEMPLATES) {
    // Fallback to original DOM creation
    return createRadioOptions(contentId, options);
  }

  try {
    // Pre-process options to include computed IDs
    const processedOptions = options.map((option) => ({
      text: option,
      value: option,
      id: `${contentId}-${option.replace(/\s+/g, '-').toLowerCase()}`,
    }));

    // Use faintly template
    const radioContainer = document.createElement('div');
    radioContainer.dataset.blockName = 'survey';

    await renderBlock(radioContainer, {
      blockName: 'survey',
      template: { name: 'radio-options' },
      codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
      contentId,
      options: processedOptions,
    });

    return radioContainer.firstElementChild; // Return the actual options div
  } catch (error) {
    logError('Radio options template failed, falling back to DOM creation:', error);
    // Fallback to original DOM creation
    return createRadioOptions(contentId, options);
  }
}

// Create slider using faintly template (Phase 4)
async function createSliderTemplate(contentId, options, questionText = '') {
  if (!USE_FAINTLY_TEMPLATES) {
    // Fallback to original DOM creation
    return createSlider(contentId, options, questionText);
  }

  try {
    // Use faintly template
    const sliderContainer = document.createElement('div');
    sliderContainer.dataset.blockName = 'survey';

    await renderBlock(sliderContainer, {
      blockName: 'survey',
      template: { name: 'slider' },
      codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
      contentId,
      options,
      questionText,
      optionsLength: String(options.length - 1),
      optionsJson: JSON.stringify(options),
    });

    return sliderContainer.firstElementChild; // Return the actual slider-container div
  } catch (error) {
    logError('Slider template failed, falling back to DOM creation:', error);
    // Fallback to original DOM creation
    return createSlider(contentId, options, questionText);
  }
}

// Create question content using faintly template (Phase 5)
async function createQuestionContentTemplate(title, question) {
  if (!USE_FAINTLY_TEMPLATES) {
    // Fallback - return null to use existing logic
    return null;
  }

  try {
    // Use faintly template (basic placeholder for now)
    const questionContainer = document.createElement('div');
    questionContainer.dataset.blockName = 'survey';

    await renderBlock(questionContainer, {
      blockName: 'survey',
      template: { name: 'question-content' },
      codeBasePath: window.hlx ? window.hlx.codeBasePath : '',
      title: title || '(no title)',
      question: question || '(no question)',
    });

    return questionContainer.firstElementChild; // Return the actual content div
  } catch (error) {
    logError('Question content template failed, using existing logic:', error);
    // Fallback - return null to use existing logic
    return null;
  }
}

// Build slide: progress + content + nav
async function createSurveyTemplate(
  progress,
  questionsCompleted,
  totalActualQuestions,
  section,
  icon,
  contentElement,
) {
  // Use new progress template function (Phase 2)
  const progressDiv = await createProgressTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
  );

  const sectionTitle = createElement('span', 'section-title', section);
  const questionIcon = createDiv('question-icon', icon);

  // Use new navigation template function (Phase 2)
  const navDiv = await createNavigationTemplate();

  const contentDiv = appendChildren(createDiv('content'), [
    sectionTitle,
    questionIcon,
    contentElement,
    navDiv,
  ]);

  return appendChildren(createDiv('survey-form'), [progressDiv, contentDiv]);
}

// Common props + progress
function getQuestionContext(questionData, currentIndex, surveyData) {
  const { Section, Icon } = questionData;
  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );
  return {
    Section,
    Icon,
    progress,
    questionsCompleted,
    totalActualQuestions,
  };
}

// Fact slide
async function createFactContent(questionData, currentIndex, surveyData) {
  const { Title, Question } = questionData;
  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  // Use new fact content template function (Phase 3)
  const contentElement = await createFactContentTemplate(Title, Question);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Interactive slide (radio/slider, supports grouped sliders)
async function createQuestion(questionData, currentIndex, surveyData) {
  const {
    ContentType, Title, Question, Options, OptionType, ContentId,
  } = questionData;

  if (ContentType === SURVEY_CONSTANTS.FACT_TYPE) {
    return createFactContent(questionData, currentIndex, surveyData);
  }

  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  // Phase 5.2: Test basic template (doesn't affect output yet)
  await createQuestionContentTemplate(Title, Question);

  // Find all related questions (q5a, q5b, q5c, etc.)
  const relatedQuestions = findRelatedQuestions(surveyData, currentIndex);
  const hasMultipleQuestions = relatedQuestions.length > 1;

  const contentElement = createDiv();

  // Add title if present
  if (Title) {
    const titleH1 = createElement('h1', 'title', Title);
    contentElement.appendChild(titleH1);
  }

  // Add main question text (unless it's multiple slider questions where each has its own text)
  if (!(hasMultipleQuestions && OptionType === SURVEY_CONSTANTS.SLIDER_TYPE)) {
    const questionH2 = createElement('h2', 'question', Question);
    contentElement.appendChild(questionH2);
  }

  // Create options container
  const optionsDiv = createDiv('options');

  if (OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
    // For radio buttons, only use the first question (no grouping for radio)
    const radioOptions = await createRadioOptionsTemplate(ContentId, Options);
    // Replace the empty optionsDiv with the template result
    contentElement.appendChild(radioOptions);
  } else if (OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
    if (hasMultipleQuestions) {
      // Create multiple related sliders dynamically
      const sliderPromises = relatedQuestions.map((relatedQuestion) => createSliderTemplate(
        relatedQuestion.ContentId,
        relatedQuestion.Options,
        relatedQuestion.Question,
      ));
      const sliders = await Promise.all(sliderPromises);
      sliders.forEach((slider) => {
        optionsDiv.appendChild(slider);
      });
      contentElement.appendChild(optionsDiv);
    } else {
      // Single slider
      const slider = await createSliderTemplate(ContentId, Options);
      optionsDiv.appendChild(slider);
      contentElement.appendChild(optionsDiv);
    }
  }

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Format answer using AnswerTemplate
function formatAnswerFromTemplate(question, selectedAnswer) {
  let template = question.AnswerTemplate;

  // Skip if no template available
  if (!template || template === 'N/A') {
    return `You selected: <strong>${selectedAnswer || '—'}</strong>.`;
  }

  // Basic answer replacement
  template = template.replace('{answer}', selectedAnswer);

  // Handle "None" -> "no" for Q5 questions
  if (template.includes('{answer_none_fix}')) {
    const value = selectedAnswer === 'None' ? 'no' : selectedAnswer.toLowerCase();
    template = template.replace('{answer_none_fix}', value);
  }

  // Handle Q4 and Q6 modifiers
  if (template.includes('{answer_modifier}')) {
    const modifiers = {
      q4: { Yes: '', No: ' not' },
      q6: { Yes: 'have', No: "haven't" },
    };
    const modifier = modifiers[question.ContentId]?.[selectedAnswer] || '';
    template = template.replace('{answer_modifier}', modifier);
  }

  // Handle Q6 "yet" suffix
  if (template.includes('{yet_modifier}')) {
    const yet = (question.ContentId === 'q6' && selectedAnswer === 'No') ? ' yet' : '';
    template = template.replace('{yet_modifier}', yet);
  }

  return template;
}

// Group related questions for answer display (q5a, q5b -> single card)
function groupQuestionsForAnswers(surveyData, surveyAnswers) {
  // First get all questions (both counted and uncounted) to find groups
  const allQuestions = surveyData.filter(
    (q) => q.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE,
  );

  const groups = [];
  let i = 0;

  while (i < allQuestions.length) {
    const currentQuestion = allQuestions[i];
    const baseId = currentQuestion.ContentId.replace(/[a-z]$/, '');

    // Check if this is part of a group (has letter suffix)
    if (baseId !== currentQuestion.ContentId) {
      // Find all related questions in the group
      const group = [currentQuestion];
      let j = i + 1;

      while (j < allQuestions.length) {
        const nextQuestion = allQuestions[j];
        const nextBaseId = nextQuestion.ContentId.replace(/[a-z]$/, '');

        if (nextBaseId === baseId && nextBaseId !== nextQuestion.ContentId) {
          group.push(nextQuestion);
          j += 1;
        } else {
          break;
        }
      }

      // Only include groups that have at least one counted question and have answers
      const hasCountedQuestion = group.some((q) => q.CountsAsQuestion === 'TRUE');
      const hasAnswers = group.some((q) => surveyAnswers[q.ContentId] != null);

      if (hasCountedQuestion && hasAnswers) {
        groups.push(group);
      }
      i = j; // Skip the grouped questions
    } else {
      // Single question - only include if counted and has answer
      if (currentQuestion.CountsAsQuestion === 'TRUE' && surveyAnswers[currentQuestion.ContentId] != null) {
        groups.push([currentQuestion]);
      }
      i += 1;
    }
  }

  return groups;
}
// Answers summary (UL/LI)
function createAnswersListUL(surveyData, surveyAnswers) {
  const questionGroups = groupQuestionsForAnswers(surveyData, surveyAnswers);
  const total = questionGroups.length;

  const ul = document.createElement('ul');
  ul.classList.add('answers-list__list');

  questionGroups.forEach((group, index) => {
    const li = document.createElement('li');
    li.classList.add('answers-list__list--item');

    // Use the first question's section for the group
    const firstQuestion = group[0];
    const sectionSpan = createElement('span', '', firstQuestion.Section || '');

    const contentWrap = createDiv('answers-list__content answer-item');
    const desc = createDiv('answer-item--description');
    const ordinal = createElement('span', '', `Answer ${index + 1}/${total}`);

    // Create container for all answers in this group
    const answersContainer = createDiv();

    group.forEach((q) => {
      const answerValue = surveyAnswers[q.ContentId];
      const formattedAnswer = formatAnswerFromTemplate(q, answerValue);
      const sentenceDiv = createElement('div');

      // Handle known safe HTML patterns or fallback to text
      if (formattedAnswer.includes('<strong>') && formattedAnswer.includes('</strong>')) {
        // Parse simple <strong> tags safely
        const parts = formattedAnswer.split('<strong>');
        parts.forEach((part, partIndex) => {
          if (partIndex === 0) {
            if (part) sentenceDiv.appendChild(document.createTextNode(part));
          } else {
            const [strongText, afterStrong] = part.split('</strong>');
            if (strongText) {
              const strongEl = createElement('strong', '', strongText);
              sentenceDiv.appendChild(strongEl);
            }
            if (afterStrong) {
              sentenceDiv.appendChild(document.createTextNode(afterStrong));
            }
          }
        });
      } else {
        // No HTML tags, use as plain text
        sentenceDiv.textContent = formattedAnswer;
      }

      answersContainer.appendChild(sentenceDiv);
    });

    appendChildren(desc, [ordinal, answersContainer]);

    const iconDiv = createDiv(
      `slide-${index + 1} answer-item--icon`,
      firstQuestion.Icon || '💡',
    );

    appendChildren(contentWrap, [desc, iconDiv]);
    appendChildren(li, [sectionSpan, contentWrap]);
    ul.appendChild(li);
  });

  return ul;
}

export default function decorate(block) {
  if (!block) return;

  // Don't decorate twice
  if (block.dataset.decorated === '1') return;
  block.dataset.decorated = '1';

  let surveyArea = block.querySelector(':scope > div:nth-child(1)');
  const logo = block.querySelector(':scope > div:nth-child(2)');
  const content = block.querySelector(':scope > div:nth-child(3)');
  const footer = block.querySelector(':scope > div:last-child');

  // Ensure survey-area wrapper exists
  if (!surveyArea && (logo || content)) {
    surveyArea = createDiv();
    block.prepend(surveyArea);
  }

  addClassIf(surveyArea, 'survey-area');

  // Promote first picture to background-image
  const bgWrapper = surveyArea?.querySelector(':scope > div:first-child');
  const pic = bgWrapper?.querySelector('picture');
  const img = pic?.querySelector('img');

  if (pic && img && surveyArea) {
    const applyBackgroundAndRemove = () => {
      if (img.currentSrc) {
        surveyArea.style.backgroundImage = `url(${img.currentSrc})`;
        addClassIf(surveyArea, 'has-background');
      }
      if (bgWrapper && bgWrapper.parentElement) {
        bgWrapper.parentElement.removeChild(bgWrapper);
      } else if (pic.parentElement) {
        pic.parentElement.removeChild(pic);
      }
    };

    if (img.currentSrc) {
      img
        .decode()
        .then(applyBackgroundAndRemove)
        .catch(applyBackgroundAndRemove);
    } else {
      img.addEventListener(
        'load',
        () => {
          img
            .decode()
            .then(applyBackgroundAndRemove)
            .catch(applyBackgroundAndRemove);
        },
        { once: true },
      );
    }
  }

  moveNode(logo, surveyArea, 'logo');
  moveNode(content, surveyArea, 'content');

  // Swap <p> button container to <div>
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    const div = createDiv();
    div.className = buttonContainer.className;
    while (buttonContainer.firstChild) {
      div.appendChild(buttonContainer.firstChild);
    }
    buttonContainer.parentNode.replaceChild(div, buttonContainer);
  }

  // Survey state
  let surveyData = [];
  let currentQuestionIndex = 0;
  let surveyAnswers = {};
  let originalContent = '';

  // Input handlers and validation helpers (defined before use)
  // Slider change handler
  function handleSliderInput(e, options, questionId) {
    const selectedIndex = parseInt(e.target.value, 10);
    surveyAnswers[questionId] = options[selectedIndex];

    // Update selected-* classes
    const trackWrapper = e.target.parentElement;

    // Remove all previous selection classes
    for (let i = 0; i < options.length; i += 1) {
      trackWrapper.classList.remove(`selected-${i}`);
    }

    // Add the current selection class
    trackWrapper.classList.add(`selected-${selectedIndex}`);

    // Clear error state when user makes a selection
    trackWrapper.classList.remove('error');
  }

  // Radio change handler
  function handleRadioChange(e, questionId) {
    surveyAnswers[questionId] = e.target.value;

    // Clear error state when user makes a selection
    const optionDiv = e.target.closest('.option');
    if (optionDiv) {
      // Clear error from all options in this question group
      const allOptions = surveyArea.querySelectorAll(
        `input[name="${questionId}"]`,
      );
      allOptions.forEach((option) => {
        const optDiv = option.closest('.option');
        if (optDiv) {
          optDiv.classList.remove('error');
        }
      });
    }
  }

  // Highlight invalid controls
  function addErrorState(question) {
    const currentQuestion = surveyData[currentQuestionIndex];

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
      // For radio buttons, find all options for this question
      const options = surveyArea.querySelectorAll(
        `input[name="${question.ContentId}"]`,
      );
      options.forEach((option) => {
        const optionDiv = option.closest('.option');
        if (optionDiv) {
          optionDiv.classList.add('error');
        }
      });
    } else if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      // For sliders, find the specific slider track wrapper
      const slider = surveyArea.querySelector(
        `input[name="${question.ContentId}"]`,
      );
      if (slider) {
        const trackWrapper = slider.closest('.slider-track-wrapper');
        if (trackWrapper) {
          trackWrapper.classList.add('error');
        }
      }
    }
  }

  // Clear all error states
  function clearErrorStates() {
    const errorElements = surveyArea.querySelectorAll(
      '.option.error, .slider-track-wrapper.error',
    );
    errorElements.forEach((element) => {
      element.classList.remove('error');
    });
  }

  // Validate current slide (incl. grouped questions)
  function validateQuestions(relatedQuestions) {
    const invalidQuestions = relatedQuestions.filter((question) => {
      const isRequired = isAnswerRequired(question);
      const hasAnswer = hasValidAnswer(question, surveyAnswers);
      return isRequired && !hasAnswer;
    });

    if (invalidQuestions.length > 0) {
      // Clear any existing error states
      clearErrorStates();

      // Add error visual feedback to invalid questions
      invalidQuestions.forEach((question) => {
        addErrorState(question);
      });

      return false;
    }

    // Clear error states if validation passes
    clearErrorStates();
    return true;
  }

  // Wire inputs for the current slide
  function attachInputListeners() {
    const currentQuestion = surveyData[currentQuestionIndex];
    const relatedQuestions = findRelatedQuestions(
      surveyData,
      currentQuestionIndex,
    );

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      const sliders = surveyArea.querySelectorAll('.slider');

      sliders.forEach((slider, index) => {
        const trackWrapper = slider.parentElement;
        const questionData = relatedQuestions[index];
        const options = JSON.parse(slider.dataset.options);

        // Listen for changes
        slider.addEventListener('input', (e) => {
          handleSliderInput(e, options, questionData.ContentId);
        });

        // Initialize values and CSS classes
        if (surveyAnswers[questionData.ContentId]) {
          const answerIndex = options.indexOf(
            surveyAnswers[questionData.ContentId],
          );
          if (answerIndex !== -1) {
            slider.value = answerIndex;
            // Add selected class for previously made selection
            trackWrapper.classList.add(`selected-${answerIndex}`);
          }
        } else {
          const defaultIndex = parseInt(slider.value, 10);
          surveyAnswers[questionData.ContentId] = options[defaultIndex];
          // Add selected class for default value too since slider shows it as selected
          trackWrapper.classList.add(`selected-${defaultIndex}`);
        }
      });
    } else if (currentQuestion.OptionType === SURVEY_CONSTANTS.RADIO_TYPE) {
      const radioButtons = surveyArea.querySelectorAll(
        `input[name="${currentQuestion.ContentId}"]`,
      );

      attachListeners(radioButtons, 'change', (e) => {
        handleRadioChange(e, currentQuestion.ContentId);
      });

      // Restore previous answers
      radioButtons.forEach((radio) => {
        if (surveyAnswers[currentQuestion.ContentId] === radio.value) {
          radio.checked = true;
        }
      });
    }
  }

  // Back/Next handler (validate on next)
  function handleNavigation(direction) {
    if (direction === 'next') {
      const relatedQuestions = findRelatedQuestions(
        surveyData,
        currentQuestionIndex,
      );

      if (!validateQuestions(relatedQuestions)) {
        return;
      }
    }

    // Emit custom event
    surveyArea.dispatchEvent(new CustomEvent(`survey:${direction}`));
  }

  // Bind nav buttons
  function attachNavigationListeners() {
    const buttons = [
      { element: surveyArea.querySelector('.btn-back'), direction: 'back' },
      { element: surveyArea.querySelector('.btn-next'), direction: 'next' },
    ];

    buttons.forEach(({ element, direction }) => {
      if (element) {
        element.addEventListener('click', () => handleNavigation(direction));
      }
    });
  }

  // Render a question slide and bind listeners
  async function showQuestion(index) {
    currentQuestionIndex = index;
    const questionData = surveyData[index];

    const questionElement = await createQuestion(questionData, index, surveyData);
    // Keep container class
    surveyArea.className = 'survey-area';
    replaceContent(surveyArea, questionElement);

    attachNavigationListeners();
    attachInputListeners();
  }

  // Start survey on click
  async function handleGetStartedClick(e) {
    e.preventDefault();

    const surveyDataPath = e.target.getAttribute('href');

    try {
      // Store original content
      originalContent = surveyArea.innerHTML;

      // Fetch + normalize survey data
      const data = await fetchSurveyData(surveyDataPath);
      // Normalize/parse data shape
      surveyData = parseSurveyData(data);

      // Start survey
      currentQuestionIndex = 0;
      surveyAnswers = {};
      await showQuestion(0);
    } catch (error) {
      logError('Failed to load survey data:', error);
      // Error logged to console - no user-facing alert needed for now
    }
  }

  // Wire up the Get Started button
  function attachGetStartedListener() {
    const getStartedButton = surveyArea.querySelector(
      '.button-container .button',
    );
    attachListeners([getStartedButton], 'click', handleGetStartedClick);
  }

  // Find the first item in a grouped set
  function findGroupStart(startIndex) {
    let index = startIndex;
    const targetQuestion = surveyData[index];
    const targetBaseId = targetQuestion.ContentId.replace(/[a-z]$/, '');

    // If not a grouped question, return as-is
    if (targetBaseId === targetQuestion.ContentId) {
      return index;
    }

    // Find the first question in the group
    while (index > 0) {
      const prevQ = surveyData[index - 1];
      const prevBaseId = prevQ.ContentId.replace(/[a-z]$/, '');

      if (prevBaseId === targetBaseId && prevBaseId !== prevQ.ContentId) {
        index -= 1;
      } else {
        break;
      }
    }

    return index;
  }

  // Jump past grouped siblings to the next question
  function getNextQuestionIndex() {
    const relatedQuestions = findRelatedQuestions(
      surveyData,
      currentQuestionIndex,
    );
    const questionsToSkip = relatedQuestions.length - 1;
    return currentQuestionIndex + 1 + questionsToSkip;
  }

  // Survey navigation event handlers
  if (surveyArea) {
    // Handle back navigation
    surveyArea.addEventListener('survey:back', async () => {
      if (currentQuestionIndex === 0) {
        // Go back to original content (trusted content, can use innerHTML)
        replaceContent(surveyArea);
        surveyArea.innerHTML = originalContent;
        attachGetStartedListener();
      } else {
        const prevIndex = findGroupStart(currentQuestionIndex - 1);
        await showQuestion(prevIndex);
      }
    });

    // Handle next/forward navigation
    surveyArea.addEventListener('survey:next', async () => {
      const nextIndex = getNextQuestionIndex();

      if (nextIndex < surveyData.length) {
        await showQuestion(nextIndex);
      } else {
        // Done: mark progress UI and show summary
        const progressDiv = surveyArea.querySelector('.progress');
        if (progressDiv) {
          // Check if "Complete!" span doesn't already exist
          if (!progressDiv.querySelector('.progress-complete')) {
            const completeSpan = createElement(
              'span',
              'progress-complete',
              'Complete!',
            );
            progressDiv.insertBefore(completeSpan, progressDiv.firstChild);
          }
        }

        // Swap content for answers summary (UL/LI)
        const contentDiv = surveyArea.querySelector('.content');
        if (contentDiv) {
          // Create header wrapper with title and subtitle
          const header = createDiv('answers-list-header');
          const answersHeading = createElement(
            'h1',
            'answers-title',
            'Your Answers',
          );
          const subtitleText = createElement('p', 'answers-subtitle');
          subtitleText.appendChild(document.createTextNode('Be sure to '));
          const saveLinkEl = createElement(
            'a',
            'save-link',
            'save your answers below',
            { href: '#save-answers' },
          );
          subtitleText.appendChild(saveLinkEl);
          subtitleText.appendChild(
            document.createTextNode(
              ' to share with your healthcare provider. Ask your healthcare provider about adding REXULTI to your antidepressant—an open conversation may help get you where you want to be.',
            ),
          );
          appendChildren(header, [answersHeading, subtitleText]);

          // Build answers list
          const listEl = createAnswersListUL(surveyData, surveyAnswers);
          const answersList = createDiv('answers-list');
          if (listEl) answersList.appendChild(listEl);

          // Compose and replace content
          const container = appendChildren(createDiv(), [header, answersList]);
          replaceContent(contentDiv, container);
        }

        // Show footer after completion: thanks + save + learn more
        const footerDiv = block.querySelector('.footer-content');
        if (footerDiv) {
          // Thank you message
          const thankYouMessage = createElement(
            'p',
            'survey-thank-you',
            'Thank you for completing this Depression Journey Questionnaire.',
          );

          // Save answers button
          const saveButton = createButton('button', 'Save Your Answers');
          saveButton.id = 'save-answers';

          // Modal builder (lazy create)
          const buildSaveAnswersModal = () => {
            // Avoid duplicate overlays
            let overlay = document.querySelector('.survey-modal-overlay');
            if (overlay) return overlay;

            overlay = createDiv('survey-modal-overlay hidden');
            overlay.setAttribute('role', 'presentation');

            const dialog = createDiv('survey-modal');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-labelledby', 'survey-modal-title');
            dialog.setAttribute('aria-describedby', 'survey-modal-desc');

            const closeBtn = createButton('survey-modal-close', '×');
            closeBtn.setAttribute('aria-label', 'Close');

            const iconWrap = createDiv('survey-modal-icon', '');
            // Re‑use one of the icons if available else fallback emoji
            iconWrap.textContent = '💡';

            const title = createElement('h2', 'survey-modal-title', 'Thank you for taking the questionnaire!', { id: 'survey-modal-title' });
            const desc = createElement('p', 'survey-modal-desc', 'Select one of the options below—you can have your answers emailed to you or download them right now. Remember to share this with your healthcare provider at your next visit.', { id: 'survey-modal-desc' });

            const actions = createDiv('survey-modal-actions');
            const emailBtn = createButton('button survey-modal-action primary', 'Email Your Answers ▶');
            emailBtn.type = 'button';
            emailBtn.dataset.action = 'email-answers';
            const pdfBtn = createButton('button survey-modal-action secondary', 'Save as PDF ↓');
            pdfBtn.type = 'button';
            pdfBtn.dataset.action = 'download-pdf';
            appendChildren(actions, [emailBtn, pdfBtn]);

            appendChildren(dialog, [closeBtn, iconWrap, title, desc, actions]);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // Focus handling
            function closeModal() {
              overlay.classList.add('hidden');
              document.body.classList.remove('survey-modal-open');
              if (saveButton) saveButton.focus();
            }

            closeBtn.addEventListener('click', closeModal);
            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) closeModal();
            });
            document.addEventListener('keydown', (e) => {
              if (!overlay.classList.contains('hidden') && e.key === 'Escape') {
                closeModal();
              }
            });

            // Placeholder actions (hook points for integration)
            emailBtn.addEventListener('click', () => {
              // TODO: integrate email sending
              // eslint-disable-next-line no-console
              console.log('Email answers action triggered', surveyAnswers);
              closeModal();
            });
            pdfBtn.addEventListener('click', () => {
              // TODO: integrate PDF generation
              // eslint-disable-next-line no-console
              console.log('Download PDF action triggered', surveyAnswers);
              closeModal();
            });

            return overlay;
          };

          const openSaveAnswersModal = () => {
            const overlay = buildSaveAnswersModal();
            if (overlay) {
              overlay.classList.remove('hidden');
              document.body.classList.add('survey-modal-open');
              const focusable = overlay.querySelector('button');
              if (focusable) focusable.focus();
            }
          };

          saveButton.addEventListener('click', (e) => {
            e.preventDefault();
            openSaveAnswersModal();
          });

          // Learn more link
          const learnMoreLink = createElement(
            'a',
            'survey-learn-more',
            'Learn more about depression and Partial Response',
            {
              href: '#',
            },
          );
          const learnMoreParagraph = createElement('p');
          learnMoreParagraph.appendChild(learnMoreLink);

          // Insert elements in footer
          const footerContentDiv = footerDiv.querySelector('div');
          if (footerContentDiv) {
            footerContentDiv.insertBefore(
              thankYouMessage,
              footerContentDiv.firstChild,
            );
            footerContentDiv.appendChild(saveButton);
            footerContentDiv.appendChild(learnMoreParagraph);
          }

          // Make footer visible
          footerDiv.style.display = 'block';

          // Scroll to save button from header link
          const saveLink = surveyArea.querySelector('.save-link');
          if (saveLink) {
            saveLink.addEventListener('click', (e) => {
              e.preventDefault();
              const saveButtonElement = document.getElementById('save-answers');
              if (saveButtonElement) {
                saveButtonElement.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                });
              }
            });
          }
        }
      }
    });
  }

  // Initialize Get Started button
  if (surveyArea) {
    attachGetStartedListener();
  }

  addClassIf(footer, 'footer-content');
}
