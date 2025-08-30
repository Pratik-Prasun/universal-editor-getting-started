/* eslint-disable no-alert */
/* eslint-disable no-console */

/**
 * Survey Block - Interactive Survey Component for AEM Edge Delivery Services
 *
 * This module handles dynamic survey rendering with support for:
 * - Multiple question types (radio, slider, fact cards)
 * - Progress tracking and navigation
 * - Related question grouping
 * - Secure DOM manipulation without innerHTML risks
 */

// Survey configuration constants
const SURVEY_CONSTANTS = {
  MANDATORY_TRUE: 'TRUE',
  QUESTION_TYPE: 'question',
  FACT_TYPE: 'fact',
  SLIDER_TYPE: 'slider',
  RADIO_TYPE: 'radio',
  JSON_EXTENSION: 'json',
};

/**
 * Validates whether a survey question requires an answer before proceeding.
 * Combines both mandatory flag and question type to determine requirement.
 */
function isAnswerRequired(question) {
  return question.Mandatory === SURVEY_CONSTANTS.MANDATORY_TRUE
    && question.ContentType === SURVEY_CONSTANTS.QUESTION_TYPE;
}

/**
 * Checks if the user has provided a valid answer for a given question.
 * Handles both null and undefined values as invalid answers.
 */
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

    if (currentBaseId === baseId && currentBaseId !== currentQuestion.ContentId) {
      relatedQuestions.push(currentQuestion);
    } else {
      break; // Stop when we find a question that doesn't belong to this group
    }
  }

  return relatedQuestions;
}

// Create DOM elements safely without innerHTML to prevent XSS
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

// Helper function for creating common div elements
function createDiv(className = '', textContent = '') {
  return createElement('div', className, textContent);
}

// Helper function for creating buttons with common attributes
function createButton(className, textContent, type = 'button') {
  return createElement('button', className, textContent, { type });
}

// Helper function to add CSS class conditionally
function addClassIf(element, className, condition = true) {
  if (element && condition) {
    element.classList.add(className);
  }
}

// Helper function to move node to target parent with class
function moveNode(node, targetParent, className) {
  if (node) {
    addClassIf(node, className);
    if (targetParent && node.parentElement !== targetParent) {
      targetParent.appendChild(node);
    }
  }
}

// Helper function to create and append multiple children to a parent
function appendChildren(parent, children) {
  children.forEach((child) => {
    if (child) parent.appendChild(child);
  });
  return parent;
}

// Helper function to attach event listeners to multiple elements
function attachListeners(elements, eventType, handler) {
  elements.forEach((element) => {
    if (element) element.addEventListener(eventType, handler);
  });
}

// Safely replace all content in a container
function replaceContent(container, newContent) {
  // Clear existing content safely
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  // Add new content
  if (typeof newContent === 'string') {
    container.textContent = newContent;
  } else if (newContent) {
    container.appendChild(newContent);
  }
}

// Create radio button options for multiple choice questions
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

// Create slider with labeled options (for rating scales)
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

  // Wrap the track elements (labels, slider input) in a constrained wrapper
  const trackWrapper = appendChildren(createDiv('slider-track-wrapper'), [labelsDiv, slider]);

  elements.push(trackWrapper);
  return appendChildren(createDiv('slider-container'), elements);
}

// Fetch survey data - handles both direct JSON URLs and path mappings
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

// Parse and normalize survey data from API response
function parseSurveyData(surveyResponse) {
  // API consistently returns {data: [...], total, offset, limit} format
  const questions = surveyResponse.data || [];

  // However, Options field may sometimes be converted to comma-separated strings
  // during Excel/AEM processing, so we need to normalize it back to arrays
  const normalizedQuestions = questions.map((item) => {
    // Ensure Options is always an array
    if (item.Options && typeof item.Options === 'string') {
      item.Options = item.Options.split(',').map((opt) => opt.trim());
    }
    return item;
  });

  // Sort by Order column
  return normalizedQuestions.sort((a, b) => parseInt(a.Order, 10) - parseInt(b.Order, 10));
}

// Calculate survey progress based on completed questions
function calculateProgress(currentIndex, surveyData) {
  const actualQuestions = surveyData.filter((q) => q.CountsAsQuestion === 'TRUE');
  const totalActualQuestions = actualQuestions.length;

  const questionsCompleted = surveyData
    .slice(0, currentIndex + 1)
    .filter((q) => q.CountsAsQuestion === 'TRUE')
    .length;

  const progress = (questionsCompleted / totalActualQuestions) * 100;
  return { progress, questionsCompleted, totalActualQuestions };
}

// Build the main survey template with progress bar and navigation
function createSurveyTemplate(
  progress,
  questionsCompleted,
  totalActualQuestions,
  section,
  icon,
  contentElement,
) {
  // Create progress section
  const progressFill = createDiv('progress-fill');
  progressFill.style.width = `${progress}%`;
  const progressTrack = appendChildren(createDiv('progress-track'), [progressFill]);
  const progressCounter = createDiv('progress-counter', `${questionsCompleted}/${totalActualQuestions}`);
  const progressDiv = appendChildren(createDiv('progress'), [progressTrack, progressCounter]);

  // Create content section
  const sectionTitle = createElement('span', 'section-title', section);
  const questionIcon = createDiv('question-icon', icon);
  const navDiv = appendChildren(createDiv('nav'), [
    createButton('btn-back', 'Back'),
    createButton('btn-next', 'Next'),
  ]);
  const contentDiv = appendChildren(createDiv('content'), [
    sectionTitle,
    questionIcon,
    contentElement,
    navDiv,
  ]);

  return appendChildren(createDiv('survey-form'), [progressDiv, contentDiv]);
}

// Helper function to extract common question data and progress
function getQuestionContext(questionData, currentIndex, surveyData) {
  const { Section, Icon } = questionData;
  const { progress, questionsCompleted, totalActualQuestions } = calculateProgress(
    currentIndex,
    surveyData,
  );
  return {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  };
}

// Create fact/information slides (non-interactive content)
function createFactContent(questionData, currentIndex, surveyData) {
  const { Title, Question } = questionData;
  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

  const contentElement = appendChildren(createDiv(), [
    createElement('h1', 'title', Title),
    createElement('p', 'fact-content', Question),
  ]);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

// Build interactive question slides (radio buttons, sliders, etc.)
function createQuestion(questionData, currentIndex, surveyData) {
  const {
    ContentType, Title, Question, Options, OptionType, ContentId,
  } = questionData;

  if (ContentType === SURVEY_CONSTANTS.FACT_TYPE) {
    return createFactContent(questionData, currentIndex, surveyData);
  }

  const {
    Section, Icon, progress, questionsCompleted, totalActualQuestions,
  } = getQuestionContext(questionData, currentIndex, surveyData);

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
    const radioOptions = createRadioOptions(ContentId, Options);
    optionsDiv.appendChild(radioOptions);
  } else if (OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
    if (hasMultipleQuestions) {
      // Create multiple related sliders dynamically
      relatedQuestions.forEach((relatedQuestion) => {
        const slider = createSlider(
          relatedQuestion.ContentId,
          relatedQuestion.Options,
          relatedQuestion.Question,
        );
        optionsDiv.appendChild(slider);
      });
    } else {
      // Single slider
      const slider = createSlider(ContentId, Options);
      optionsDiv.appendChild(slider);
    }
  }

  contentElement.appendChild(optionsDiv);

  return createSurveyTemplate(
    progress,
    questionsCompleted,
    totalActualQuestions,
    Section,
    Icon,
    contentElement,
  );
}

export default function decorate(block) {
  if (!block) return;

  // prevent running twice on the same block
  if (block.dataset.decorated === '1') return;
  block.dataset.decorated = '1';

  // capture the top-level divs
  let surveyArea = block.querySelector(':scope > div:nth-child(1)');
  const logo = block.querySelector(':scope > div:nth-child(2)');
  const content = block.querySelector(':scope > div:nth-child(3)');
  const footer = block.querySelector(':scope > div:last-child');

  // create a survey-area wrapper if missing
  if (!surveyArea && (logo || content)) {
    surveyArea = createDiv();
    block.prepend(surveyArea);
  }

  // apply the survey-area class
  addClassIf(surveyArea, 'survey-area');

  // handle background picture → CSS background
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
      img.decode()
        .then(applyBackgroundAndRemove)
        .catch(applyBackgroundAndRemove);
    } else {
      img.addEventListener('load', () => {
        img.decode()
          .then(applyBackgroundAndRemove)
          .catch(applyBackgroundAndRemove);
      }, { once: true });
    }
  }

  // move nodes in their original order
  moveNode(logo, surveyArea, 'logo');
  moveNode(content, surveyArea, 'content');

  // Convert button paragraph to div using consistent approach
  const buttonContainer = block.querySelector('p.button-container');
  if (buttonContainer) {
    const div = createDiv();
    div.className = buttonContainer.className; // Keep existing classes intact
    // Copy all child nodes safely
    while (buttonContainer.firstChild) {
      div.appendChild(buttonContainer.firstChild);
    }
    buttonContainer.parentNode.replaceChild(div, buttonContainer);
  }

  // Survey state management
  let surveyData = [];
  let currentQuestionIndex = 0;
  let surveyAnswers = {};
  let originalContent = '';

  // Function to navigate to specific question
  function showQuestion(index) {
    currentQuestionIndex = index;
    const questionData = surveyData[index];

    const questionElement = createQuestion(questionData, index, surveyData);

    // Preserve the original container structure and styling
    surveyArea.className = 'survey-area';
    replaceContent(surveyArea, questionElement);

    // Attach event listeners
    // eslint-disable-next-line no-use-before-define
    attachNavigationListeners();
    // eslint-disable-next-line no-use-before-define
    attachInputListeners();
  }

  // Handle Get Started button click
  async function handleGetStartedClick(e) {
    e.preventDefault();

    const surveyDataPath = e.target.getAttribute('href');

    try {
      // Store original content
      originalContent = surveyArea.innerHTML;

      // Fetch and parse survey data
      const data = await fetchSurveyData(surveyDataPath);
      console.log('Survey data loaded:', data);

      // Assuming the data is CSV format, parse it
      surveyData = parseSurveyData(data);
      console.log('Parsed survey questions:', surveyData);

      // Start survey
      currentQuestionIndex = 0;
      surveyAnswers = {};
      showQuestion(0);
    } catch (error) {
      console.error('Failed to load survey data:', error);
      alert('Failed to load survey. Please try again.');
    }
  }

  // Function to attach Get Started button listener
  function attachGetStartedListener() {
    const getStartedButton = surveyArea.querySelector('.button-container .button');
    attachListeners([getStartedButton], 'click', handleGetStartedClick);
  }

  // Handle slider input change
  function handleSliderInput(e, options, questionId) {
    const selectedIndex = parseInt(e.target.value, 10);
    surveyAnswers[questionId] = options[selectedIndex];

    // Update CSS class to show the correct dialog
    const trackWrapper = e.target.parentElement;

    // Remove all previous selection classes
    for (let i = 0; i < options.length; i += 1) {
      trackWrapper.classList.remove(`selected-${i}`);
    }

    // Add the current selection class
    trackWrapper.classList.add(`selected-${selectedIndex}`);
  }

  // Handle radio button change
  function handleRadioChange(e, questionId) {
    surveyAnswers[questionId] = e.target.value;
  }

  // Validate all related questions before navigation
  function validateQuestions(relatedQuestions) {
    const invalidQuestions = relatedQuestions.filter((question) => {
      const isRequired = isAnswerRequired(question);
      const hasAnswer = hasValidAnswer(question, surveyAnswers);
      return isRequired && !hasAnswer;
    });

    if (invalidQuestions.length > 0) {
      const questionCount = relatedQuestions.length;
      const message = questionCount > 1
        ? `Please select an option for all ${questionCount} questions before continuing.`
        : 'Please select an option before continuing.';
      alert(message);
      return false;
    }
    return true;
  }

  // Attach input event listeners
  function attachInputListeners() {
    const currentQuestion = surveyData[currentQuestionIndex];
    const relatedQuestions = findRelatedQuestions(surveyData, currentQuestionIndex);

    if (currentQuestion.OptionType === SURVEY_CONSTANTS.SLIDER_TYPE) {
      const sliders = surveyArea.querySelectorAll('.slider');

      sliders.forEach((slider, index) => {
        const trackWrapper = slider.parentElement;
        const questionData = relatedQuestions[index];
        const options = JSON.parse(slider.dataset.options);

        // Attach event listener
        slider.addEventListener('input', (e) => {
          handleSliderInput(e, options, questionData.ContentId);
        });

        // Initialize values and CSS classes
        if (surveyAnswers[questionData.ContentId]) {
          const answerIndex = options.indexOf(surveyAnswers[questionData.ContentId]);
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
      const radioButtons = surveyArea.querySelectorAll(`input[name="${currentQuestion.ContentId}"]`);

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

  // Unified navigation handler
  function handleNavigation(direction) {
    if (direction === 'next') {
      const relatedQuestions = findRelatedQuestions(surveyData, currentQuestionIndex);

      if (!validateQuestions(relatedQuestions)) {
        return;
      }
    }

    // Emit custom event
    surveyArea.dispatchEvent(new CustomEvent(`survey:${direction}`));
  }

  // Attach navigation event listeners
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

  // Helper function to find the start of a question group
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

  // Helper function to calculate next question index
  function getNextQuestionIndex() {
    const relatedQuestions = findRelatedQuestions(surveyData, currentQuestionIndex);
    const questionsToSkip = relatedQuestions.length - 1;
    return currentQuestionIndex + 1 + questionsToSkip;
  }

  // Survey navigation event handlers
  if (surveyArea) {
    // Handle back navigation
    surveyArea.addEventListener('survey:back', () => {
      if (currentQuestionIndex === 0) {
        // Go back to original content (trusted content, can use innerHTML)
        replaceContent(surveyArea);
        surveyArea.innerHTML = originalContent;
        attachGetStartedListener();
      } else {
        const prevIndex = findGroupStart(currentQuestionIndex - 1);
        showQuestion(prevIndex);
      }
    });

    // Handle next/forward navigation
    surveyArea.addEventListener('survey:next', () => {
      const nextIndex = getNextQuestionIndex();

      if (nextIndex < surveyData.length) {
        showQuestion(nextIndex);
      } else {
        // Survey complete
        console.log('Survey completed:', surveyAnswers);
        alert('Survey completed! Check console for answers.');
      }
    });
  }

  // Initialize Get Started button
  if (surveyArea) {
    attachGetStartedListener();
  }

  addClassIf(footer, 'footer-content');
}
